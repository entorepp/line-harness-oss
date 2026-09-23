import { api, type FriendWithTags } from './api'

export async function loadChatFriends(accountId: string, channelType?: string): Promise<FriendWithTags[]> {
  const friends: FriendWithTags[] = []
  let offset = 0
  while (true) {
    const response = await api.friends.list({ accountId, limit: '100', offset: String(offset) })
    if (!response.success) throw new Error('Friends unavailable')
    const page = response.data
    friends.push(...page.items)
    // WhatsApp numbers must remain available beyond the first contact page.
    if (channelType !== 'whatsapp' || !page.hasNextPage || page.items.length === 0) break
    offset += page.items.length
  }
  return friends
}
