interface SocialAccount {
  id: string;
  platform: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: string;
  connectedAt: string;
}

let accounts = $state<SocialAccount[]>([]);
let loading = $state(false);

export const accountsStore = {
  get accounts() { return accounts; },
  get loading() { return loading; },
  set(a: SocialAccount[]) { accounts = a; },
  add(a: SocialAccount) { accounts = [...accounts, a]; },
  remove(id: string) { accounts = accounts.filter(a => a.id !== id); },
  startLoad() { loading = true; },
  endLoad() { loading = false; },
};
