# Program output and runner message limits

Assigned programs return `{exitCode, stdout, stderr}` directly. Their combined output
is bounded to 32 MiB, with a separate 64 KiB stderr bound. The legacy `output:
"artifact"` request is accepted for installed recipes but returns the same in-memory
reply. It creates no `.program-output-<uuid>.json` file and no storage-accounting row.
New recipes should omit the option and read `reply.stdout`.

The private runner socket uses newline-delimited JSON. Each message is bounded to
256 KiB: the initial run input, script requests, log messages, terminal results and
individual reply frames. This is an application protocol bound, not a Node heap
limit. It bounds unfinished lines and individual JSON parsing/serialization work;
256 KiB is a chosen policy value, not a fundamental requirement of Node or sockets.
The broker previously held the complete output in memory before writing it to disk,
so the old file mode did not reduce its peak stdout memory use.

Large program replies use ordered stdout/stderr chunks and a final result envelope.
Each chunk contains at most 32 Ki UTF-16 code units, never splits a surrogate pair,
and fits even when JSON escapes each code unit. The receiver checks ordering and
cumulative UTF-8 byte limits, assembles the strings, then resolves the caller's promise.
The sender awaits each socket write with cancellation, bounding its pending write
queue. EOF, malformed chunks and exceeded limits fail the operation; partial output
is not reported as a completed reply. Ordinary request/log/result bounds remain in
place. Output itself is not a durable effect receipt and is never a reason to replay
an external action whose outcome is uncertain.

Central publication sends structured views only. It neither walks workspace files
nor captures or uploads script/source blobs. Script/source text needed by the UI is
already present in the relevant views. When a publication retires old generated output
paths, the relay removes their unreferenced content in that publication's transaction.
An identical hash used by another retained or non-generated path is preserved.
Other legacy server artifact copies are not deleted by this targeted cleanup.

Owner-authorized local cleanup runs after installation and confirmed absence of old
executions. It removes only regular, single-link files with the exact generated UUID
filename pattern in the Pod workspace root. It preserves other local files and all
business state, approvals and execution receipts.
