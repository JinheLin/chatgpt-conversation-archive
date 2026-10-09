<box border radius="lg" padding={3} gap={2}>
  <title>Block 的时间范围与 Snapshot T 的关系</title>
  <svg viewBox="0 0 400 60" width="100%">
    <line x1="20" y1="30" x2="380" y2="30" stroke="#ccc"/>
    <rect x="100" y="20" width="180" height="20" fill="rgba(55,120,195,0.12)"/>
    <text x="100" y="55" textAnchor="middle">100</text>
    <text x="280" y="55" textAnchor="middle">300</text>
  </svg>
  <table>
    <table-row>
      <table-cell>**T <escape><</escape> MinTS**</table-cell>
      <table-cell>所有记录都在未来，跳过 Block</table-cell>
    </table-row>
    <table-row>
      <table-cell>**MinTS ≤ T <escape><</escape> MaxTS**</table-cell>
      <table-cell>部分版本可见，继续查找</table-cell>
    </table-row>
    <table-row>
      <table-cell>**T ≥ MaxTS**</table-cell>
      <table-cell>所有已提交版本均不晚于 T，可免去逐条上界比较</table-cell>
    </table-row>
  </table>
</box>
