# Apollo · site institucional + Área do Cliente

Site da Apollo (apollocompany.netlify.app): home com introdução 3D, Apollo Drive, planos, serviços, sobre e **Área do Cliente** (conta, escolha de plano, cadastro da empresa e pagamento por cartão).

- Páginas: HTML/CSS/JS puros. O build da Netlify só copia `*.html` e `assets/` para `dist/`.
- Funções (`netlify/functions`): pagamento com Stripe, contas com Supabase e criação automática da empresa no Apollo Drive.
- Configuração passo a passo: `AREA_CLIENTE_SETUP.md`. Banco: `supabase/schema.sql`.
- Pré-visualização das telas sem contas reais: `/area-cliente.html?demo=1`.
