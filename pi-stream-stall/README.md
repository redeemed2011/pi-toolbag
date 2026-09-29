# pi-stream-stall

Ends a provider stream that connects and then goes silent. The turn finishes as `stopReason: "error"` with `timeout` in the message, so pi-auto-fallback can hop. It does not call `abort()`. Escape already proved that does not wake this read.

The extension wraps the live provider `stream` and `streamSimple`. It does not register a replacement provider, so grok-cli account routing stays intact. The same wrap applies to every provider the registry knows.

Default silence is 180 seconds, reset on every stream event. A local model that prefills longer than that will also be ended; raise the timeout or set it to `0`.

```bash
PI_STREAM_STALL_TIMEOUT_MS=300000 pi
pi --stream-stall-timeout-ms 0
```

`0`, `off`, and `false` disable the watchdog. The flag wins over the env var.
