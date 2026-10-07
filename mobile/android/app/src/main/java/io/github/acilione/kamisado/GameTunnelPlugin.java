package io.github.acilione.kamisado;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import fi.iki.elonen.NanoHTTPD;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** Only transport and static files live here. TypeScript remains the game authority. */
@CapacitorPlugin(name = "GameTunnel")
public class GameTunnelPlugin extends Plugin {
    private static boolean isAlive(Process process) {
        if (process == null) return false;
        try { process.exitValue(); return false; }
        catch (IllegalThreadStateException running) { return true; }
    }
    private final ExecutorService lifecycle = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, Guest> guests = new ConcurrentHashMap<>();
    private volatile Process connector;
    private BridgeServer server;
    private volatile String origin;
    private volatile boolean serving;
    private String provider;
    private volatile String diagnostic = "The invitation service did not connect in time. Try again.";
    private ScheduledExecutorService maintenance;
    private AndroidDnsProxy dns;

    private static class Guest {
        final BlockingQueue<JSONObject> output = new ArrayBlockingQueue<>(64);
        volatile long lastPoll = System.currentTimeMillis();
        long rateWindow = 0;
        int requests = 0;
        boolean polling;
    }

    @PluginMethod public void start(PluginCall call) {
        final String mode = call.getString("mode", "tunnl");
        lifecycle.execute(() -> {
            try {
                if (!mode.equals("cloudflare") && !mode.equals("tunnl")) throw new IOException("On Android, choose Cloudflare or tunnl.gg. ngrok hosting is desktop-only.");
                if (android.os.Build.VERSION.SDK_INT < 29) throw new IOException("Internet hosting requires Android 10 or newer. You can still join invitations in your browser and play offline.");
                if (isAlive(connector) && mode.equals(provider) && origin != null) {
                    call.resolve(new JSObject().put("origin", origin)); return;
                }
                stopInternal();
                diagnostic = mode.equals("tunnl") ? "tunnl.gg did not connect in time. Check your network or choose Cloudflare." : "Cloudflare did not register the tunnel in time. Try again.";
                File binary = new File(getContext().getApplicationInfo().nativeLibraryDir, mode.equals("tunnl") ? "libtunnl.so" : "libcloudflared.so");
                if (!binary.isFile()) throw new IOException("This APK is missing the selected connector for this processor. Install the full Android build.");
                server = new BridgeServer();
                server.start(35000, true);
                File config = new File(getContext().getCacheDir(), "quick-tunnel.yml");
                try (FileOutputStream stream = new FileOutputStream(config)) { stream.write("{}\n".getBytes(StandardCharsets.UTF_8)); }
                String local = "http://127.0.0.1:" + server.getListeningPort();
                List<String> args = mode.equals("tunnl")
                    ? Arrays.asList(binary.getAbsolutePath(), "--port", String.valueOf(server.getListeningPort()), "--state", new File(getContext().getFilesDir(), "tunnl").getAbsolutePath())
                    : Arrays.asList(binary.getAbsolutePath(), "tunnel", "--config", config.getAbsolutePath(), "--no-autoupdate", "--protocol", "http2", "--url", local);
                ProcessBuilder builder = new ProcessBuilder(args).redirectErrorStream(true);
                builder.environment().put("HOME", getContext().getFilesDir().getAbsolutePath());
                dns = new AndroidDnsProxy();
                builder.environment().put("KAMISADO_DNS_PROXY", dns.address());
                final Process process = connector = builder.start();
                provider = mode;
                CompletableFuture<String> ready = new CompletableFuture<>();
                new Thread(() -> readConnector(process, ready), "kamisado-tunnel-output").start();
                origin = ready.get(65, TimeUnit.SECONDS);
                // Registration confirms the outbound tunnel. Java's negative DNS cache can
                // reject a fresh public hostname even while a guest browser can open it.
                if (!isAlive(process)) throw new IOException("The service closed the tunnel. Try creating the game again.");
                serving = true;
                maintenance = Executors.newSingleThreadScheduledExecutor();
                maintenance.scheduleAtFixedRate(() -> {
                    long now = System.currentTimeMillis();
                    guests.forEach((id, guest) -> { if (now - guest.lastPoll > 60000) closeGuest(id); });
                }, 30, 30, TimeUnit.SECONDS);
                call.resolve(new JSObject().put("origin", origin));
            } catch (Exception error) {
                stopInternal();
                Throwable cause = error instanceof ExecutionException ? error.getCause() : error;
                String message = cause instanceof IOException ? cause.getMessage() : diagnostic;
                call.reject(message);
            }
        });
    }

    private void readConnector(Process process, CompletableFuture<String> ready) {
        String address = null;
        boolean registered = false;
        final boolean tunnl = "tunnl".equals(provider);
        Pattern pattern = Pattern.compile(tunnl ? "^READY (https://[a-z0-9]+(?:-[a-z0-9]+)+\\.tunnl\\.gg)$" : "https://[a-z0-9]+(?:-[a-z0-9]+)+\\.trycloudflare\\.com\\b");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (tunnl) {
                    if (line.startsWith("ERROR ")) diagnostic = line.substring(6);
                    if (line.equals("RECONNECTING") && connector == process && serving) notifyListeners("status", new JSObject().put("reconnecting", true));
                    Matcher invitation = pattern.matcher(line);
                    if (invitation.matches()) {
                        ready.complete(invitation.group(1));
                        if (connector == process && serving) notifyListeners("status", new JSObject().put("reconnecting", false));
                    }
                    continue;
                }
                // Keep private invitation addresses out of Android's shared logs.
                String lower = line.toLowerCase(Locale.ROOT);
                if (lower.contains("429") || lower.contains("too many requests")) diagnostic = "Cloudflare is limiting new tunnels. Wait a minute, then try again.";
                else if (lower.contains("x509") || lower.contains("certificate verify")) diagnostic = "Cloudflare's certificate could not be verified. Check the phone's date and Internet connection.";
                else if (lower.contains("no such host") || lower.contains("dns query failed")) diagnostic = "The phone could not resolve Cloudflare's address. Check its Internet or private DNS settings.";
                else if (lower.contains("connection refused") || lower.contains("i/o timeout")) diagnostic = "The phone could not reach Cloudflare's tunnel network. Try another connection.";
                Matcher match = pattern.matcher(line);
                if (match.find()) address = match.group();
                if (line.contains("Registered tunnel connection")) registered = true;
                if (address != null && registered) ready.complete(address);
            }
        } catch (IOException ignored) { }
        ready.completeExceptionally(new IOException(diagnostic));
        if (connector == process) {
            boolean wasReady = serving;
            origin = null;
            if (wasReady) notifyListeners("stopped", new JSObject());
            if (!lifecycle.isShutdown()) lifecycle.execute(() -> { if (connector == process) stopInternal(); });
        }
    }

    @PluginMethod public void send(PluginCall call) {
        Guest guest = guests.get(call.getString("session", ""));
        JSObject frame = call.getObject("frame");
        if (guest != null && frame != null && !guest.output.offer(frame)) closeGuest(call.getString("session"));
        call.resolve();
    }

    @PluginMethod public void stop(PluginCall call) {
        lifecycle.execute(() -> { stopInternal(); call.resolve(); });
    }

    private void closeGuest(String id) {
        Guest guest = guests.remove(id);
        if (guest != null) {
            guest.output.offer(new JSONObject());
            notifyListeners("request", new JSObject().put("session", id).put("action", "close"));
        }
    }

    private void stopInternal() {
        Process active = connector;
        connector = null;
        serving = false;
        origin = null;
        if (active != null) {
            active.destroy();
            try {
                for (int attempt = 0; attempt < 20 && isAlive(active); attempt++) Thread.sleep(100);
                if (isAlive(active) && android.os.Build.VERSION.SDK_INT >= 26) active.destroyForcibly();
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); active.destroy(); }
        }
        if (maintenance != null) { maintenance.shutdownNow(); maintenance = null; }
        if (dns != null && android.os.Build.VERSION.SDK_INT >= 29) { dns.close(); dns = null; }
        for (String id : guests.keySet()) closeGuest(id);
        if (server != null) { server.stop(); server = null; }
    }

    @Override protected void handleOnDestroy() {
        lifecycle.execute(this::stopInternal);
        lifecycle.shutdown();
    }

    private class BridgeServer extends NanoHTTPD {
        BridgeServer() {
            super("127.0.0.1", 0);
            // Bound incoming workers, including stalled requests, rather than creating unlimited threads.
            setAsyncRunner(new AsyncRunner() {
                final Set<ClientHandler> clients = ConcurrentHashMap.newKeySet();
                final ExecutorService workers = Executors.newFixedThreadPool(16);
                public void exec(ClientHandler handler) {
                    synchronized (clients) {
                        if (clients.size() >= 16) { handler.close(); return; }
                        clients.add(handler);
                    }
                    workers.execute(handler);
                }
                public void closed(ClientHandler handler) { clients.remove(handler); }
                public void closeAll() { clients.forEach(ClientHandler::close); clients.clear(); workers.shutdownNow(); }
            });
        }

        private Response json(Response.Status status, String body) {
            Response response = newFixedLengthResponse(status, "application/json", body);
            response.addHeader("Cache-Control", "no-store");
            response.addHeader("X-Content-Type-Options", "nosniff");
            return response;
        }

        @Override public Response serve(IHTTPSession request) {
            try {
                String route = request.getUri();
                if (route.equals("/health") && request.getMethod() == Method.GET) return json(Response.Status.OK, "{\"status\":\"ok\"}");
                if (route.startsWith("/bridge/")) {
                    if (request.getMethod() != Method.POST || !"application/json".equals(request.getHeaders().get("content-type"))) return json(Response.Status.BAD_REQUEST, "{}");
                    // No CORS and no form requests. Session handles are random and scoped to this tunnel.
                    String requestOrigin = request.getHeaders().get("origin");
                    if (requestOrigin != null && !requestOrigin.equals(origin)) return json(Response.Status.FORBIDDEN, "{}");
                    int length = Integer.parseInt(request.getHeaders().getOrDefault("content-length", "0"));
                    if (length < 2 || length > 16384) return json(Response.Status.BAD_REQUEST, "{}");
                    byte[] bytes = new byte[length];
                    new DataInputStream(request.getInputStream()).readFully(bytes);
                    JSONObject body = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    if (route.equals("/bridge/connect")) {
                        synchronized (guests) {
                            if (guests.size() >= 8) return json(Response.Status.SERVICE_UNAVAILABLE, "{}");
                            String id = UUID.randomUUID().toString();
                            guests.put(id, new Guest());
                            notifyListeners("request", new JSObject().put("session", id).put("action", "connect"));
                            return json(Response.Status.OK, new JSONObject().put("session", id).toString());
                        }
                    }
                    String id = body.optString("session");
                    Guest guest = guests.get(id);
                    if (guest == null) return json(Response.Status.NOT_FOUND, "{}");
                    if (route.equals("/bridge/poll")) {
                        synchronized (guest) {
                            if (guest.polling) return json(Response.Status.BAD_REQUEST, "{}");
                            guest.polling = true;
                        }
                        try {
                            guest.lastPoll = System.currentTimeMillis();
                            JSONObject first = guest.output.poll(25, TimeUnit.SECONDS);
                            JSONArray frames = new JSONArray();
                            if (first != null) frames.put(first);
                            List<JSONObject> rest = new ArrayList<>();
                            guest.output.drainTo(rest);
                            rest.forEach(frames::put);
                            return json(Response.Status.OK, frames.toString());
                        } finally { guest.polling = false; }
                    }
                    if (route.equals("/bridge/send")) {
                        synchronized (guest) {
                            long second = System.currentTimeMillis() / 1000;
                            if (guest.rateWindow != second) { guest.rateWindow = second; guest.requests = 0; }
                            if (++guest.requests > 30) return json(Response.Status.SERVICE_UNAVAILABLE, "{}");
                        }
                        JSONObject frame = body.optJSONObject("frame");
                        if (frame == null) return json(Response.Status.BAD_REQUEST, "{}");
                        notifyListeners("request", new JSObject().put("session", id).put("action", "send").put("frame", frame));
                        return json(Response.Status.OK, "{}");
                    }
                    if (route.equals("/bridge/close")) { closeGuest(id); return json(Response.Status.OK, "{}"); }
                    return json(Response.Status.NOT_FOUND, "{}");
                }
                if (request.getMethod() != Method.GET && request.getMethod() != Method.HEAD) return json(Response.Status.METHOD_NOT_ALLOWED, "{}");
                String file = (route.equals("/") || route.matches("/game/[a-f0-9]{12}/?")) ? "index.html" : route.substring(1);
                if (!Set.of("index.html", "guest.js", "style.css", "realistic.css").contains(file)) return json(Response.Status.NOT_FOUND, "{}");
                String mime = file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
                InputStream stream = getContext().getAssets().open("tunnel/" + file);
                Response response = newChunkedResponse(Response.Status.OK, mime, stream);
                response.addHeader("X-Content-Type-Options", "nosniff");
                response.addHeader("Referrer-Policy", "no-referrer");
                response.addHeader("Cache-Control", file.equals("index.html") ? "no-store" : "public, max-age=3600");
                return response;
            } catch (Exception error) { return json(Response.Status.BAD_REQUEST, "{}"); }
        }
    }
}
