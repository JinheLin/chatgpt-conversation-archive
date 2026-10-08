### 1. 当前 SST 的核心结构

从 `builder.rs` 的 `Builder::add` 和 `Builder::finish` 可以确认，当前 SST 大致采用以下布局：

<box border radius="lg" padding={3} gap={2}>
<text weight="medium" size="sm">Cloud Storage Engine SST 文件布局</text>
<box background="surface-secondary" radius="md" padding={2} align="center" gap={1}>
<text weight="semibold">Main Data Blocks</text>
<text color="secondary" size="xs">每个 Key 的主版本 · 通常是最新版本</text>
</box>
<box background="surface-secondary" radius="md" padding={2} align="center" gap={1}>
<text weight="semibold">Old Data Blocks</text>
<text color="secondary" size="xs">同一 Key 的旧 MVCC 版本</text>
</box>
<grid columns={2} gap={2}>
<grid-item><box border radius="md" padding={2} align="center"><text size="sm" weight="medium">Main Index</text></box></grid-item>
<grid-item><box border radius="md" padding={2} align="center"><text size="sm" weight="medium">Old Index</text></box></grid-item>
</grid>
<box border radius="md" padding={2} align="center">**Aux Index · BinaryFuse8**</box>
<box border radius="md" padding={2} align="center">**Properties**</box>
<box background="surface-secondary" radius="md" padding={2} align="center">**Footer**</box>
<caption>各区域按此顺序序列化。Main Index、Old Index 与 BinaryFuse8 都用于不同层次的定位或过滤。</caption>
</box>
