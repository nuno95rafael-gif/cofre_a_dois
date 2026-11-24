// Ligação ao Supabase (projeto "cofre-a-dois"). Estes dois valores são PÚBLICOS por natureza
// (vão sempre para o browser); a segurança dos dados é garantida pelas políticas RLS.
window.COFRE_CONFIG = {
  url: 'https://bfseukytmycwizxzxuur.supabase.co',
  key: 'sb_publishable_9slQIZLuyZnkBRvoGTxj5A_ZfbOl3CN',
  // chave pública das notificações (VAPID); a privada só existe no Supabase Vault
  vapidPublic: 'BOKI5odt5P0whlUKs5yr8XsuU-prXDvYmV0hW4a-T2cJOT-QAkZ8NzDtUqhRMo2PfF1sIQqoLP8Z7UV0-quY9V8'
};
