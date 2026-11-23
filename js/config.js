// Ligação ao Supabase. Estes dois valores são PÚBLICOS por natureza (vão para o browser);
// a segurança dos dados é garantida pelas políticas RLS da base de dados.
window.COFRE_CONFIG = {
  url: 'COLOCAR_URL_DO_PROJETO',          // ex.: https://xxxxxxxx.supabase.co
  key: 'COLOCAR_CHAVE_PUBLICA'            // chave "publishable" (sb_publishable_...) ou "anon"
};
