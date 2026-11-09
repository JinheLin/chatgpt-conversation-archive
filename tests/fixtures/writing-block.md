<WritingBlock id="58321" variant="standard">## Scope: What This Article Does Not Cover

A production-grade write-ahead log involves much more than writing bytes to persistent storage. Its on-disk format is equally important: record framing, checksums, sequence numbers, torn-write detection, segment organization, and crash recovery all influence correctness and performance.

However, WAL format design is a substantial topic in its own right, and it is outside the scope of this article.

To isolate the behavior of the I/O path, we treat each WAL entry as an opaque, fixed-size data block. We focus exclusively on how these blocks are written, batched, scheduled, and made durable.

Specifically, we explore the effects of `fsync` and `fdatasync`, file preallocation and reuse, Buffered versus Direct I/O, Group Commit, and asynchronous write pipelines.

The implementation developed throughout the article is therefore a **WAL write-path prototype**, not a complete, crash-recoverable WAL implementation.</WritingBlock>
