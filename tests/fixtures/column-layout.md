<box border radius="lg" padding={3} gap={2}>
  <box background="surface-secondary" radius="md" padding={3} align="center" gap={1}>
    **FTS Query / ClaraIndexReader**
    <caption>不关心 Packed / Dedicated 的物理存储格式</caption>
  </box>
  <icon name="arrow-down"/>
  <box border radius="md" padding={3} align="center" gap={1}>
    **FtsIndexHandle**
    <caption>统一的 TantivyIndexLayout + IndexDataSource</caption>
  </box>
  <grid columns={2} gap={3}>
    <col align="center" gap={2}>
      <icon name="arrow-down"/>
      <box width="100%" background="surface-secondary" radius="md" padding={3} align="center" gap={1}>
        **EmbeddedIndexSource**
        <caption>PackedFile / LP 内嵌 Bytes</caption>
        <caption>同步 slice、零拷贝</caption>
      </box>
    </col>
    <col align="center" gap={2}>
      <icon name="arrow-down"/>
      <box width="100%" background="surface-secondary" radius="md" padding={3} align="center" gap={1}>
        **FileIndexSource**
        <caption>DedicatedFile / 独立数据区</caption>
        <caption>异步 mmap_range</caption>
      </box>
    </col>
  </grid>
  <icon name="arrow-down"/>
  <box border radius="md" padding={3} align="center" gap={1}>
    **FtsCache + IA**
    <caption>首期全部保持原有语义</caption>
  </box>
</box>
