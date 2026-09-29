export type Profile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  handle: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  is_group: boolean;
  name: string | null;
  created_by: string | null;
  created_at: string;
  // agregações carregadas pelo client
  last_message?: Message | null;
  unread_count?: number;
  other_user?: Profile | null;
  participants?: Profile[];
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: "text" | "audio" | "image" | "system";
  body: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  image_url: string | null;
  reply_to_id: string | null;
  deleted: boolean;
  created_at: string;
  sender?: Profile | null;
  reply_to?: { id: string; body: string | null; kind: string; sender_name: string } | null;
};

export type ChatListItem = {
  conversation: Conversation;
  lastMessage: Message | null;
  unread: number;
  otherUser: Profile | null;
  participants: Profile[];
};
