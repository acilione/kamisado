//go:build android

package main

import (
	"context"
	"net"
	"os"
)

// Android has no resolv.conf. Forward Go's DNS wire queries (including SRV)
// to the app's loopback bridge, which uses Android's network/private DNS API.
func init() {
	if address := os.Getenv("KAMISADO_DNS_PROXY"); address != "" {
		net.DefaultResolver = &net.Resolver{
			PreferGo: true,
			Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "udp", address)
			},
		}
	}
}
