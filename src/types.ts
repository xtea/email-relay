export interface Env {
  INBOX: KVNamespace;
  INBOX_TOKEN: string;
}

export interface InboxRecord {
  from: string;
  to: string;
  subject: string;
  received_at: number;
  source: string;
  artifacts: {
    link?: string;
    code?: string;
  };
}
