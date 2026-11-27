// Sampled instruments for the web player: SynthKit's Sampler playing the
// web sample pack (web/samples/web/, built by tools/build_samples.py). A
// program is fetched and decoded only when a song first asks for it; the
// part plays its synth until then. Decoding runs on the main thread (SynthKit's
// own Ogg Vorbis decoder, the same one the app uses) so the audio thread never
// stalls; the finished set reaches the Sampler in one step.

/** Where the site serves the web sample pack. */
export const SAMPLES_BASE = new URL("../../samples/web/", import.meta.url);

export class SampleLibrary {
  constructor(kit, { base = SAMPLES_BASE, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.kit = kit;
    this.base = base;
    this.fetch = fetchImpl;
    this.index = null;
    this.programs = new Map(); // id -> Promise<program.json>
  }

  /** The pack's index ({programs: [{id, name, role, bytes, level?}]}), or null if this site has no samples. */
  async loadIndex() {
    if (this.index !== null) return this.index;
    try {
      const res = await this.fetch(new URL("index.json", this.base));
      this.index = res.ok ? await res.json() : { programs: [] };
    } catch {
      this.index = { programs: [] };
    }
    return this.index;
  }

  async has(id) {
    const idx = await this.loadIndex();
    return idx.programs.some((p) => p.id === id);
  }

  program(id) {
    if (!this.programs.has(id)) {
      const p = this.fetch(new URL(`${id}/program.json`, this.base)).then((r) => {
        if (!r.ok) throw new Error(`sample program ${id}: ${r.status}`);
        return r.json();
      });
      p.catch(() => this.programs.delete(id)); // try again next time
      this.programs.set(id, p);
    }
    return this.programs.get(id);
  }

  /** Fetches and decodes a program's zones: [{pcm, channels, rate, root, ...}]. */
  async zones(id) {
    const prog = await this.program(id);
    const files = await Promise.all(prog.zones.map(async (z) => {
      const r = await this.fetch(new URL(`${id}/${z.file}`, this.base));
      if (!r.ok) throw new Error(`sample ${id}/${z.file}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }));
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const z = prog.zones[i];
      const d = this.kit.decodeOgg(files[i]);
      if (!d) continue;
      out.push({ pcm: d.pcm, channels: d.channels, rate: d.rate, root: z.root, tune: z.tune, lo: z.lo, hi: z.hi,
        vlo: z.vlo, vhi: z.vhi, loopStart: z.loop_start, loopEnd: z.loop_end, gain: z.gain });
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
    return { program: prog, zones: out };
  }
}

/**
 * A part's Sampler: loads the sample program the blend asks for and says
 * when it's ready. One program at a time; asking for another replaces it.
 */
export class PartSampler {
  constructor(kit, library, destination, { phone = false } = {}) {
    this.kit = kit;
    this.library = library;
    this.destination = destination;
    this.phone = phone;
    this.synth = null;
    this.out = null;
    this.live = null; // the program loaded and playing
    this.loading = null;
    this.wanted = null;
  }

  /** Asks for a program (null = none). Resolves true when `id` is live. */
  async want(id) {
    this.wanted = id;
    if (!id || id === this.live) return id === this.live;
    if (this.loading === id) return false;
    if (!(await this.library.has(id))) return false;
    this.loading = id;
    try {
      if (!this.synth) {
        this.synth = await this.kit.createSynth("Sampler");
        this.out = this.kit.context.createGain();
        this.synth.connect(this.out);
        this.out.connect(this.destination);
      }
      const { program, zones } = await this.library.zones(id);
      if (this.wanted !== id) return false;
      this.synth.allNotesOff();
      await this.synth.resetParams?.();
      if (!(await this.synth.loadSampleSet(zones))) return false;
      for (const [k, v] of Object.entries(program.params || {})) this.synth.setParam(k, v);
      if (this.phone) {
        this.synth.setParam("voice.quality", 0);
        this.synth.setParam("voice.count", 16);
      }
      this.out.gain.value = program.level ?? 1;
      this.live = id;
      return this.wanted === id;
    } catch (e) {
      console.warn("[samples]", e?.message ?? e);
      return false;
    } finally {
      if (this.loading === id) this.loading = null;
    }
  }

  get ready() { return !!this.live && this.live === this.wanted; }

  dispose() {
    this.synth?.dispose();
    this.out?.disconnect();
  }
}
