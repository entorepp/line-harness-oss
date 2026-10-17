import { WhatsAppRecorder, type RecordingSink } from './whatsapp-recorder'

// Browser-to-Meta WebRTC. Recording uses only this call's existing audio tracks.
export class WhatsAppAudio {
  private pc: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private closed = false
  private remote: MediaStream | null = null
  private recording: WhatsAppRecorder | null = null
  private recordingStopped = false
  private audioSender: RTCRtpSender | null = null
  private cancelNotice: (() => void) | null = null
  constructor(private audio: HTMLAudioElement, private onState: (state: RTCPeerConnectionState) => void) {}
  async prepare(remoteOffer?: string): Promise<string> {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('このブラウザでは通話できません。ChromeまたはSafariで開いてください。')
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); throw new Error('通話準備を中止しました') }
    this.mute(true)
    const pc = this.pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })
    pc.onconnectionstatechange = () => this.onState(pc.connectionState)
    pc.ontrack = event => {
      this.remote = event.streams[0] || new MediaStream([event.track])
      this.audio.srcObject = this.remote
      void this.audio.play().catch(() => this.onState('disconnected'))
    }
    if (remoteOffer) await pc.setRemoteDescription({ type: 'offer', sdp: remoteOffer })
    const sender = this.audioSender = pc.addTrack(this.stream.getAudioTracks()[0], this.stream)
    const transceiver = pc.getTransceivers().find(t => t.sender === sender)
    const codecs = RTCRtpSender.getCapabilities('audio')?.codecs.filter(codec => codec.mimeType.toLowerCase() === 'audio/opus')
    if (transceiver?.setCodecPreferences && codecs?.length) transceiver.setCodecPreferences(codecs)
    const description = remoteOffer ? await pc.createAnswer() : await pc.createOffer()
    const sdp = description.sdp?.includes('a=ptime:') ? description.sdp : `${description.sdp}a=ptime:20\r\n`
    await pc.setLocalDescription({ type: description.type, sdp })
    if (pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('音声接続の準備がタイムアウトしました')) }, 8000)
      const check = () => { if (pc.iceGatheringState === 'complete') { cleanup(); resolve() } }
      const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check) }
      pc.addEventListener('icegatheringstatechange', check); check()
    })
    if (this.closed || !pc.localDescription?.sdp) throw new Error('音声接続を準備できませんでした')
    return pc.localDescription.sdp
  }
  async answer(sdp: string) {
    if (!this.pc || this.closed) return
    if (!this.pc.remoteDescription) await this.pc.setRemoteDescription({ type: 'answer', sdp })
  }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted }) }
  async announceRecording() {
    if (this.closed || this.recordingStopped || !this.audioSender || !this.stream) throw new Error('録音案内を開始できませんでした')
    const original = this.stream.getAudioTracks()[0]
    const sender = this.audioSender
    const context = new AudioContext()
    let notice: AudioBufferSourceNode | null = null
    let destination: MediaStreamAudioDestinationNode | null = null
    try {
      await context.resume()
      if (context.state !== 'running') throw new Error('録音案内の音声を再生できませんでした')
      const response = await fetch('/audio/whatsapp-recording-notice-en.wav')
      if (!response.ok) throw new Error('録音案内の音声を読み込めませんでした')
      const buffer = await context.decodeAudioData(await response.arrayBuffer())
      if (buffer.duration < 2 || this.closed || this.recordingStopped) throw new Error('録音案内を中止しました')
      destination = context.createMediaStreamDestination()
      context.createMediaStreamSource(this.stream).connect(destination)
      notice = context.createBufferSource(); notice.buffer = buffer
      notice.connect(destination); notice.connect(context.destination)
      await sender.replaceTrack(destination.stream.getAudioTracks()[0])
      await new Promise<void>((resolve, reject) => {
        notice!.onended = () => { this.cancelNotice = null; resolve() }
        this.cancelNotice = () => { try { notice?.stop() } catch {} ; reject(new Error('録音案内を中止しました')) }
        if (this.closed || this.recordingStopped) this.cancelNotice()
        else notice!.start()
      })
    } finally {
      this.cancelNotice = null
      if (!this.closed) await sender.replaceTrack(original).catch(() => {})
      notice?.disconnect()
      destination?.stream.getTracks().forEach(track => track.stop())
      if (context.state !== 'closed') await context.close()
    }
  }
  async startRecording(sink: RecordingSink) {
    if (this.recording || this.recordingStopped || this.closed || !this.stream || !this.remote) throw new Error('双方の音声が接続されてから録音してください')
    const recorder = new WhatsAppRecorder(sink)
    this.recording = recorder
    try { await recorder.start(this.stream, this.remote) }
    catch (error) { await recorder.stop(); throw error }
  }
  async stopRecording() {
    this.recordingStopped = true
    this.cancelNotice?.()
    if (this.recording) await this.recording.stop()
  }
  close() {
    // stop() requests the final recording data synchronously before the call tracks end.
    void this.stopRecording()

    this.closed = true
    this.pc?.close(); this.pc = null
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.audio.srcObject = null
  }
}
