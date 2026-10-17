export type RecordedCallPart = { index: number; blob: Blob; startedAt: number; endedAt: number }
export type RecordingSink = {
  part(part: RecordedCallPart): Promise<void>
  complete(partCount: number): Promise<void>
  failure(message: string): void
}

// Only receives existing call streams. It never captures another microphone,
// desktop, tab, or another operator's observed call.
export class WhatsAppRecorder {
  private context: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private sources: MediaStreamAudioSourceNode[] = []
  private recorder: MediaRecorder | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sequence = 0
  private stopped = false
  private failed = false
  private pending: Promise<void> = Promise.resolve()
  private finishing: Promise<void> | null = null
  private mime = ''
  constructor(private sink: RecordingSink, private segmentMs = 8 * 60 * 1000) {}

  async start(local: MediaStream, remote: MediaStream) {
    if (this.context || this.stopped) throw new Error('録音は既に開始済みか終了しています')
    if (typeof MediaRecorder === 'undefined') throw new Error('このブラウザでは通話録音を利用できません')
    if (!local.getAudioTracks().length || !remote.getAudioTracks().length) throw new Error('双方の音声が接続されてから録音してください')
    this.mime = ['audio/webm;codecs=opus', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || ''
    if (!this.mime) throw new Error('対応する録音形式がありません')
    const context = this.context = new AudioContext()
    try {
      await context.resume()
      if (this.stopped) throw new Error('録音を中止しました')
      if (context.state !== 'running') throw new Error('音声処理の開始をブラウザで許可してください')
      this.destination = context.createMediaStreamDestination()
      for (const stream of [local, remote]) {
        const source = context.createMediaStreamSource(stream)
        source.connect(this.destination); this.sources.push(source)
      }
      this.startPart()
      this.timer = setInterval(() => this.rotate(), this.segmentMs)
    } catch (error) { await this.dispose(); throw error }
  }

  private startPart() {
    const index = this.sequence++, startedAt = Date.now(), chunks: Blob[] = []
    const recorder = this.recorder = new MediaRecorder(this.destination!.stream, { mimeType: this.mime, audioBitsPerSecond: 48000 })
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => this.fail('録音中にブラウザのエラーが発生しました。通話は継続できます。')
    const stopped = new Promise<void>(resolve => {
      recorder.onstop = () => {
        const part = { index, blob: new Blob(chunks, { type: this.mime }), startedAt, endedAt: Date.now() }
        this.pending = this.pending.then(async () => {
          if (!part.blob.size) throw new Error('録音音声が空です')
          if (part.blob.size > 24 * 1024 * 1024) throw new Error('録音ファイルが上限を超えています')
          await this.sink.part(part)
        }).catch(error => this.fail(error instanceof Error ? error.message : '録音を保存できませんでした'))
        resolve()
      }
    })
    this.partStops.push(stopped)
    recorder.start()
  }
  private partStops: Promise<void>[] = []
  private rotate() {
    if (this.stopped || !this.recorder || this.recorder.state === 'inactive') return
    // Each part is a complete, independently decodable file. Starting its
    // successor before stopping the previous recorder avoids a silent gap.
    const previous = this.recorder
    try { this.startPart(); previous.stop() } catch { this.fail('録音の分割に失敗しました'); void this.stop() }
  }
  private fail(message: string) {
    if (!this.failed) { this.failed = true; this.sink.failure(message); if (!this.stopped) void this.stop() }
  }
  stop(): Promise<void> {
    if (this.finishing) return this.finishing
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.finishing = (async () => {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
      await Promise.all(this.partStops)
      await this.pending
      if (this.sequence && !this.failed) {
        try { await this.sink.complete(this.sequence) }
        catch (error) { this.fail(error instanceof Error ? error.message : '録音の保存完了を確認できませんでした') }
      }
      await this.dispose()
    })()
    return this.finishing
  }
  private async dispose() {
    this.sources.forEach(source => source.disconnect()); this.sources = []
    // These tracks belong to the mixed output only. The call owns its original tracks.
    this.destination?.stream.getTracks().forEach(track => track.stop())
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.destination = null; this.context = null
  }
}
