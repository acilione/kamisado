// Kamisado's account-free SSH transport. The game remains in TypeScript.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Observed on proxy.tunnl.gg:22 on 2026-10-07 using Windows and Linux
// ssh-keyscan. Upstream does not publish a fingerprint in its documentation.
// Fail closed on rotation; do not silently replace this key or use the SSH agent.
const relayKey = "AAAAC3NzaC1lZDI1NTE5AAAAIN3HFkIcqgWI6Sa1E31KiUbcfcrX/5MZl4LnaQnUYL8K"

var invitationPattern = regexp.MustCompile(`https://[a-z0-9]+(?:-[a-z0-9]+)+\.tunnl\.gg\b`)
var errHostKey = errors.New("tunnl.gg's server key has changed. Update Kamisado before connecting")

func verifyKey(expected string) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, key ssh.PublicKey) error {
		raw, err := base64.StdEncoding.DecodeString(expected)
		if err != nil || !bytes.Equal(raw, key.Marshal()) {
			return errHostKey
		}
		return nil
	}
}

func identity(directory string) (ssh.Signer, error) {
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	file := filepath.Join(directory, "identity")
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		block, err := ssh.MarshalPrivateKey(key, "Kamisado tunnel")
		if err != nil {
			return nil, err
		}
		data = pem.EncodeToMemory(block)
		// Exclusive creation never replaces another running instance's identity.
		handle, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			data, err = os.ReadFile(file)
		} else if err == nil {
			_, err = handle.Write(data)
			closeErr := handle.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	return ssh.ParsePrivateKey(data)
}

// Reads are bounded even if the TCP connection goes silently stale.
type deadlineConn struct{ net.Conn }

func (c deadlineConn) Read(p []byte) (int, error) {
	_ = c.Conn.SetReadDeadline(time.Now().Add(40 * time.Second))
	return c.Conn.Read(p)
}

func connect(ctx context.Context, address, pin, local string, signer ssh.Signer, ready func(string)) error {
	tcp, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer tcp.Close()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			tcp.Close()
		case <-done:
		}
	}()
	_ = tcp.SetDeadline(time.Now().Add(20 * time.Second))
	connection, channels, requests, err := ssh.NewClientConn(deadlineConn{tcp}, address, &ssh.ClientConfig{
		User: "stable", Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, HostKeyCallback: verifyKey(pin),
		HostKeyAlgorithms: []string{ssh.KeyAlgoED25519},
	})
	if err != nil {
		return err
	}
	_ = tcp.SetDeadline(time.Time{})
	client := ssh.NewClient(connection, channels, requests)
	defer client.Close()
	listener, err := client.Listen("tcp", "0.0.0.0:80")
	if err != nil {
		return err
	}
	defer listener.Close()
	// Limit remote forwarding to the game port, with a bound on active channels.
	slots := make(chan struct{}, 32)
	go func() {
		for {
			remote, err := listener.Accept()
			if err != nil {
				return
			}
			select {
			case slots <- struct{}{}:
			default:
				remote.Close()
				continue
			}
			go func() {
				defer func() { <-slots }()
				defer remote.Close()
				target, err := net.DialTimeout("tcp", local, 5*time.Second)
				if err != nil {
					return
				}
				defer target.Close()
				copied := make(chan struct{})
				go func() { _, _ = io.Copy(remote, target); remote.Close(); close(copied) }()
				_, _ = io.Copy(target, remote)
				target.Close()
				<-copied
			}()
		}
	}()
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	// A nil Stdin makes ssh.Session send EOF immediately. The relay interprets
	// that as the user closing their terminal and removes the tunnel.
	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	defer stdin.Close()
	stdout, err := session.StdoutPipe()
	if err != nil {
		return err
	}
	session.Stderr = io.Discard // Never expose server terminal text as app instructions.
	if err := session.RequestPty("xterm", 24, 100, ssh.TerminalModes{ssh.ECHO: 0}); err != nil {
		return err
	}
	if err := session.Shell(); err != nil {
		return err
	}
	registered := make(chan struct{})
	var once sync.Once
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if origin := invitationPattern.FindString(scanner.Text()); origin != "" {
				once.Do(func() { ready(origin); close(registered) })
			}
		}
	}()
	go func() {
		timer := time.NewTimer(20 * time.Second)
		defer timer.Stop()
		select {
		case <-registered:
		case <-timer.C:
			client.Close()
		case <-done:
		}
	}()
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if _, _, err := client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
					client.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()
	return session.Wait()
}

func main() {
	port := flag.Int("port", 0, "Local game port")
	directory := flag.String("state", "", "Private app state directory")
	flag.Parse()
	if *port < 1 || *port > 65535 || *directory == "" {
		fmt.Println("ERROR Invalid connector configuration.")
		os.Exit(1)
	}
	signer, err := identity(*directory)
	if err != nil {
		fmt.Println("ERROR Could not load the app's tunnl.gg identity.")
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	connected := false
	var stateMutex sync.Mutex
	var expectedOrigin string
	failures := 0
	for {
		err = connect(ctx, "proxy.tunnl.gg:22", relayKey, "127.0.0.1:"+strconv.Itoa(*port), signer, func(origin string) {
			stateMutex.Lock()
			defer stateMutex.Unlock()
			if expectedOrigin != "" && expectedOrigin != origin {
				cancel()
				return
			}
			expectedOrigin = origin
			connected = true
			failures = 0
			fmt.Println("READY " + origin)
		})
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, errHostKey) {
			fmt.Println("ERROR " + errHostKey.Error())
			os.Exit(1)
		}
		stateMutex.Lock()
		failures++
		exhausted := !connected || failures >= 3
		stateMutex.Unlock()
		if exhausted {
			fmt.Println("ERROR tunnl.gg could not keep the connection open. Check your network or choose another service.")
			os.Exit(1)
		}
		fmt.Println("RECONNECTING")
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
