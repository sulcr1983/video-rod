// 实验 5：关掉 mp4box 日志 + 给 trex 默认时长，看耗时和帧数是否改善
(async () => {
  const D = window.__vrDash;
  const T = {};
  const t0 = Date.now();
  const logInfo = { hasLog: !!MP4Box.Log, hasSetLogLevel: !!(MP4Box.Log && MP4Box.Log.setLogLevel) };
  try {
    if (MP4Box.Log && MP4Box.Log.setLogLevel) MP4Box.Log.setLogLevel(MP4Box.Log.error);
    logInfo.ok = true;
  } catch (e) { logInfo.ok = String(e); }

  const open = (buf) => {
    const f = MP4Box.createFile();
    f.onError = () => {};
    buf.fileStart = 0;
    f.appendBuffer(buf);
    f.flush();
    const trak = f.moov.traks[0];
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const u8 = new Uint8Array(buf);
    const list = [];
    for (let i = 0; i < trak.samples.length; i++) {
      const s = trak.samples[i];
      if (!(s.offset >= 0 && s.size > 0 && s.offset + s.size <= buf.byteLength)) continue;
      list.push({ data: u8.subarray(s.offset, s.offset + s.size), duration: s.duration || 1,
                  dts: s.dts || 0, cts: s.cts || 0, is_sync: !!s.is_sync,
                  t: (s.dts || 0) / trak.mdia.mdhd.timescale });
    }
    return { entry, list, timescale: trak.mdia.mdhd.timescale };
  };

  const V = open(D.vb), A = open(D.ab);
  T.parse = Date.now() - t0;

  const t1 = Date.now();
  const out = MP4Box.createFile();
  const outErrs = [];
  out.onError = (e) => outErrs.push(String(e));
  const vLast = V.list[V.list.length - 1], aLast = A.list[A.list.length - 1];
  const vId = out.addTrack({
    id: 1, type: 'avc1', timescale: V.timescale,
    width: V.entry.width, height: V.entry.height, hdlr: 'vide', name: 'VideoHandler',
    default_sample_duration: vLast.duration, default_sample_size: vLast.data.byteLength,
    description_boxes: [V.entry.avcC].filter(Boolean)
  });
  const aId = out.addTrack({
    id: 2, type: 'mp4a', timescale: A.timescale,
    channel_count: A.entry.channel_count || 2, samplesize: A.entry.samplesize || 16,
    samplerate: A.entry.samplerate || 44100, hdlr: 'soun', name: 'SoundHandler',
    default_sample_duration: aLast.duration, default_sample_size: aLast.data.byteLength,
    description_boxes: [A.entry.esds].filter(Boolean)
  });
  T.addTrack = Date.now() - t1;

  const t2 = Date.now();
  let i = 0, j = 0, n = 0;
  while (i < V.list.length || j < A.list.length) {
    let takeV;
    if (i >= V.list.length) takeV = false;
    else if (j >= A.list.length) takeV = true;
    else takeV = V.list[i].t <= A.list[j].t;
    const s = takeV ? V.list[i++] : A.list[j++];
    out.addSample(takeV ? vId : aId, s.data,
      { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: takeV ? s.is_sync : true });
    n++;
    if (n % 2000 === 0) { window.__vrMuxPct = n; await new Promise(r => setTimeout(r, 0)); }
  }
  T.addSample = Date.now() - t2;

  const t3 = Date.now();
  const bufOut = out.getBuffer();
  T.write = Date.now() - t3;
  const abuf = (bufOut instanceof ArrayBuffer) ? bufOut : (bufOut && bufOut.buffer) ? bufOut.buffer : null;
  T.total = Date.now() - t0;
  if (!abuf) return { err: 'getBuffer 异常', T, logInfo };

  const name = '钓鱼竿1080P合成验证.mp4';
  const blob = new Blob([abuf], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 180000);

  return { downloaded: true, name: name, T: T, logInfo: logInfo, outErrs: outErrs,
           written: n, outBytes: abuf.byteLength,
           vsrc: V.list.length, asrc: A.list.length };
})()
