package io.github.acilione.kamisado;

import android.net.DnsResolver;
import android.os.CancellationSignal;
import androidx.annotation.RequiresApi;
import java.io.IOException;
import java.net.*;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;

/** Bridges DNS wire queries to Android, preserving its VPN and private DNS policy. */
@RequiresApi(29)
final class AndroidDnsProxy implements AutoCloseable {
    private final DatagramSocket socket;
    private final ScheduledExecutorService executor = Executors.newScheduledThreadPool(2);
    private final ConcurrentHashMap<String, CancellationSignal> pending = new ConcurrentHashMap<>();

    AndroidDnsProxy() throws IOException {
        socket = new DatagramSocket(0, InetAddress.getByName("127.0.0.1"));
        new Thread(this::receive, "kamisado-dns").start();
    }

    String address() { return "127.0.0.1:" + socket.getLocalPort(); }

    private void receive() {
        while (!socket.isClosed()) {
            try {
                DatagramPacket packet = new DatagramPacket(new byte[4096], 4096);
                socket.receive(packet);
                if (packet.getLength() < 12 || pending.size() >= 32) continue;
                byte[] query = Arrays.copyOf(packet.getData(), packet.getLength());
                String id = UUID.randomUUID().toString();
                CancellationSignal cancel = new CancellationSignal();
                pending.put(id, cancel);
                executor.schedule(() -> {
                    if (pending.remove(id) != null) { cancel.cancel(); respond(packet, failed(query)); }
                }, 5, TimeUnit.SECONDS);
                DnsResolver.getInstance().rawQuery(null, query, DnsResolver.FLAG_EMPTY, executor, cancel,
                    new DnsResolver.Callback<byte[]>() {
                        public void onAnswer(byte[] answer, int rcode) {
                            if (pending.remove(id) != null) respond(packet, answer);
                        }
                        public void onError(DnsResolver.DnsException error) {
                            if (pending.remove(id) != null) respond(packet, failed(query));
                        }
                    });
            } catch (IOException | RuntimeException error) {
                if (socket.isClosed()) return;
            }
        }
    }

    private static byte[] failed(byte[] query) {
        byte[] answer = query.clone();
        answer[2] |= (byte) 0x80; // response
        answer[3] = (byte) ((answer[3] & 0xf0) | 2); // SERVFAIL
        return answer;
    }

    private void respond(DatagramPacket request, byte[] answer) {
        try { socket.send(new DatagramPacket(answer, answer.length, request.getAddress(), request.getPort())); }
        catch (IOException ignored) { /* The host may have stopped while DNS was resolving. */ }
    }

    @Override public void close() {
        socket.close();
        pending.values().forEach(CancellationSignal::cancel);
        pending.clear();
        executor.shutdownNow();
    }
}
