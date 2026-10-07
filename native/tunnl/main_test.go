package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func testSigner(t *testing.T) ssh.Signer {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	return signer
}

func TestPinAndIdentity(t *testing.T) {
	key := testSigner(t).PublicKey()
	pin := base64.StdEncoding.EncodeToString(key.Marshal())
	if err := verifyKey(pin)("", nil, key); err != nil {
		t.Fatal(err)
	}
	if err := verifyKey(pin)("", nil, testSigner(t).PublicKey()); err != errHostKey {
		t.Fatal("changed relay key accepted")
	}
	directory := t.TempDir()
	first, err := identity(directory)
	if err != nil {
		t.Fatal(err)
	}
	second, err := identity(directory)
	if err != nil || !bytes.Equal(first.PublicKey().Marshal(), second.PublicKey().Marshal()) {
		t.Fatal("identity was not retained")
	}
}

func TestForwardAndCancel(t *testing.T) {
	relay, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer relay.Close()
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	go func() {
		c, err := target.Accept()
		if err == nil {
			defer c.Close()
			io.Copy(c, c)
		}
	}()
	signer := testSigner(t)
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	forwarded := make(chan error, 1)
	go func() {
		raw, err := relay.Accept()
		if err != nil {
			forwarded <- err
			return
		}
		server, channels, requests, err := ssh.NewServerConn(raw, config)
		if err != nil {
			raw.Close()
			forwarded <- err
			return
		}
		defer server.Close()
		go func() {
			for r := range requests {
				r.Reply(r.Type == "tcpip-forward" || r.Type == "keepalive@openssh.com", nil)
			}
		}()
		for ch := range channels {
			session, requests, err := ch.Accept()
			if err != nil {
				forwarded <- err
				return
			}
			go func() {
				io.Copy(io.Discard, session)
				server.Close() // The public relay ends the tunnel on terminal EOF.
			}()
			go func() {
				defer session.Close()
				for r := range requests {
					r.Reply(true, nil)
					if r.Type != "shell" {
						continue
					}
					fmt.Fprintln(session, "https://test-game-1234.tunnl.gg")
					payload := ssh.Marshal(struct {
						Host       string
						Port       uint32
						Origin     string
						OriginPort uint32
					}{"0.0.0.0", 80, "127.0.0.1", 1234})
					remote, reqs, err := server.OpenChannel("forwarded-tcpip", payload)
					if err != nil {
						forwarded <- err
						return
					}
					go ssh.DiscardRequests(reqs)
					defer remote.Close()
					if _, err = remote.Write([]byte("hello")); err == nil {
						answer := make([]byte, 5)
						_, err = io.ReadFull(remote, answer)
						if err == nil && string(answer) != "hello" {
							err = fmt.Errorf("unexpected forwarded response")
						}
					}
					forwarded <- err
				}
			}()
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ready := make(chan string, 1)
	finished := make(chan error, 1)
	go func() {
		finished <- connect(ctx, relay.Addr().String(), base64.StdEncoding.EncodeToString(signer.PublicKey().Marshal()), target.Addr().String(), testSigner(t), func(url string) { ready <- url })
	}()
	select {
	case err := <-forwarded:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("forward timed out")
	}
	select {
	case url := <-ready:
		if url != "https://test-game-1234.tunnl.gg" {
			t.Fatal(url)
		}
	case <-ctx.Done():
		t.Fatal("no invitation")
	}
	cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancel left the SSH session running")
	}
}
