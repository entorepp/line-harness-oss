// Browser-to-Meta WebRTC. No recording or third-party media server.
export class WhatsAppAudio {
  private pc: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private closed = false
  constructor(private audio: HTMLAudioElement, private onState: (state: RTCPeerConnectionState) => void) {}
  async prepare(remoteOffer?: string): Promise<string> {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('このブラウザでは通話できません。ChromeまたはSafariで開いてください。')
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); throw new Error('通話準備を中止しました') }
    this.mute(true)
    const pc = this.pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })
    pc.onconnectionstatechange = () => this.onState(pc.connectionState)
    pc.ontrack = event => {
      this.audio.srcObject = event.streams[0] || new MediaStream([event.track])
      void this.audio.play().catch(() => this.onState('disconnected'))
    }
    if (remoteOffer) await pc.setRemoteDescription({ type: 'offer', sdp: remoteOffer })
    const sender = pc.addTrack(this.stream.getAudioTracks()[0], this.stream)
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
  close() {
    this.closed = true
    this.pc?.close(); this.pc = null
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.audio.srcObject = null
  }
}
