# Área do Cliente — passo a passo de configuração

Tudo é feito primeiro em **modo de teste** (nenhum dinheiro real). Só depois que um cadastro de teste funcionar do começo ao fim é que você troca para as chaves reais.

**Ordem recomendada:** 1. Supabase → 2. Google → 3. Stripe → 4. Netlify → 5. Render (depois que a outra aba publicar a API) → 6. Teste.

Para revisar as telas sem configurar nada: `https://apollocompany.netlify.app/area-cliente.html?demo=1`

---

## 1. Supabase (contas e login dos clientes) — grátis
1. Crie uma conta em **supabase.com** e um projeto chamado `apollo-clientes`, na região **South America (São Paulo)**.
2. **SQL Editor → New query**: cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. **Project Settings → API**: anote
   - `Project URL` → vai em **SUPABASE_URL**
   - `anon public` → vai em **SUPABASE_ANON_KEY**
   - `service_role` → vai em **SUPABASE_SERVICE_ROLE_KEY** (⚠️ secreta, nunca no site nem no GitHub)
4. **Authentication → URL Configuration**:
   - Site URL: `https://apollocompany.netlify.app`
   - Redirect URLs: `https://apollocompany.netlify.app/area-cliente.html`
5. **Authentication → Sign In / Providers → Email**: deixe ativo, com "Confirm email" ligado.
6. (Opcional) **Authentication → Emails**: traduza os textos dos e-mails de confirmação e de recuperação de senha para português.

## 2. Google (botão "Continuar com Google") — grátis
1. Entre em **console.cloud.google.com** e crie um projeto `Apollo`.
2. **APIs e serviços → Tela de consentimento OAuth**: escolha Externo; nome do app `Apollo`; seu e-mail de suporte; domínios autorizados `netlify.app` e `supabase.co`. Publique o app.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**
   - URI de redirecionamento autorizado: `https://<SEU-PROJETO>.supabase.co/auth/v1/callback` (o Supabase mostra esse endereço no passo seguinte)
4. Copie o **Client ID** e o **Client Secret** e cole no Supabase em **Authentication → Sign In / Providers → Google** (ative o provedor).

## 3. Stripe (pagamento no cartão)
1. Crie a conta em **stripe.com** (país Brasil). Para receber dinheiro de verdade, a Stripe vai pedir CPF ou CNPJ e conta bancária. Para testar, não precisa.
2. Confira que o botão **"Modo de teste"** está ligado (canto superior direito).
3. **Catálogo de produtos → Adicionar produto**. Crie 3 produtos, todos com preço **recorrente mensal em BRL**:
   - Apollo Drive Essencial: R$ 349,00
   - Apollo Drive Profissional: R$ 1.290,00
   - Apollo Drive Gestão: R$ 2.199,00
   
   De cada um, copie o **ID do preço** (`price_...`): **STRIPE_PRICE_ESSENCIAL**, **STRIPE_PRICE_PROFISSIONAL**, **STRIPE_PRICE_GESTAO**.
4. **Desenvolvedores → Chaves de API**: copie a **Chave secreta** (`sk_test_...`) para **STRIPE_SECRET_KEY**.
5. **Desenvolvedores → Webhooks → Adicionar destino**:
   - URL: `https://apollocompany.netlify.app/api/stripe-webhook`
   - Eventos: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
   - Copie o **Segredo de assinatura** (`whsec_...`) para **STRIPE_WEBHOOK_SECRET**.
6. **Configurações → Faturamento → Portal do cliente**: ative a troca de cartão, o histórico de faturas e o cancelamento de assinatura.

## 4. Netlify (site + funções)
1. No site **apollocompany**: **Site configuration → Build & deploy → Link repository** → GitHub → **HissingSnow/Apollo**, branch `main`. As configurações de build vêm sozinhas do `netlify.toml`.
2. **Site configuration → Environment variables**. Adicione (marque as secretas como "Contains secret values"):

| Variável | Valor |
|---|---|
| `SITE_URL` | `https://apollocompany.netlify.app` |
| `SUPABASE_URL` | (passo 1.3) |
| `SUPABASE_ANON_KEY` | (passo 1.3) |
| `SUPABASE_SERVICE_ROLE_KEY` | (passo 1.3) 🔒 |
| `STRIPE_SECRET_KEY` | (passo 3.4) 🔒 |
| `STRIPE_WEBHOOK_SECRET` | (passo 3.5) 🔒 |
| `STRIPE_PRICE_ESSENCIAL` | (passo 3.3) |
| `STRIPE_PRICE_PROFISSIONAL` | (passo 3.3) |
| `STRIPE_PRICE_GESTAO` | (passo 3.3) |
| `APOLLO_API_URL` | `https://apollo-drive.onrender.com` |
| `APOLLO_LOGIN_URL` | `https://apollo-drive.onrender.com/` |
| `APOLLO_PROVISION_TOKEN` | o valor do arquivo `TOKEN_PROVISIONAMENTO_APAGAR_DEPOIS.txt` 🔒 |

3. **Deploys → Trigger deploy → Deploy site**.

## 5. Render (Apollo Drive)
Isso só depois que a outra aba publicar as rotas de `APOLLO_DRIVE_ESPEC_PROVISIONAMENTO.md`.
- No serviço Apollo Drive, em **Environment**, adicione `APOLLO_PROVISION_TOKEN` com **o mesmo valor** da Netlify.
- Recomendado: sair do plano gratuito. No gratuito, o sistema "dorme" e a primeira criação de empresa pode atrasar 1 ou 2 minutos (o site tenta de novo sozinho, mas o cliente espera).

## 6. Teste de ponta a ponta (modo de teste)
1. Abra `area-cliente.html`, crie uma conta e confirme o e-mail. Teste também o botão do Google.
2. Escolha um plano e preencha os dados. CNPJ de teste válido: `11.222.333/0001-81`. CPF de teste válido: `529.982.247-25`.
3. Na Stripe, use o cartão **4242 4242 4242 4242**, com qualquer validade futura e qualquer CVC.
4. Você volta para a Área do Cliente, e em segundos aparece "Tudo pronto!".
5. Entre em `https://apollo-drive.onrender.com/` com o usuário e a senha que você definiu.
6. Confira, como Super ADM, que a empresa apareceu com o plano, os limites e a assinatura certos.
7. Teste um cartão recusado (`4000 0000 0000 0002`) e o botão "Gerenciar pagamento".

## 7. Ir para valer
Depois que tudo funcionar em teste: na Stripe, desligue o modo de teste, recrie os 3 preços e o webhook no modo real, e troque na Netlify `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e os 3 `STRIPE_PRICE_*` pelos valores reais.

**Antes de vender:** publicar os **Termos de uso** e a **Política de privacidade (LGPD)**. Os links já aparecem no formulário de cadastro.
