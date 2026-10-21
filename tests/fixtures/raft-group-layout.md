假设一个事务同时修改三个 Shard，对应三个独立的 Raft Group。

<box border radius="lg" padding={3}>
  <svg viewBox="0 0 620 280" width="100%">
    {#each [0,1,2] as i}
      <rect x={20+i*200} y="14" width="180" height="54" rx="10" fill="rgba(80,130,240,0.12)" stroke="#7fa6ff"/>
      <text x={110+i*200} y="48" fontSize="19" textAnchor="middle">Raft Group {String.fromCharCode(65+i)}</text>
      <rect x={20+i*200} y="94" width="180" height="64" rx="9" fill="rgba(240,170,80,0.12)" stroke="#eea461"/>
      <text x={110+i*200} y="118" fontSize="18" textAnchor="middle">Prepare</text>
      <text x={110+i*200} y="142" fontSize="18" textAnchor="middle">Raft Commit</text>
      <rect x={20+i*200} y="194" width="180" height="64" rx="9" fill="rgba(70,170,110,0.12)" stroke="#6dc98d"/>
      <text x={110+i*200} y="218" fontSize="18" textAnchor="middle">Commit</text>
      <text x={110+i*200} y="242" fontSize="18" textAnchor="middle">Raft Commit</text>
    {/each}
  </svg>
  <caption align="center">两轮依次执行的共识阶段</caption>
</box>
