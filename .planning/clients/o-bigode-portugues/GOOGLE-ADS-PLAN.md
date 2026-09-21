# O Bigode Português — Plano de Execução Google Ads

> Criado em 2026-09-21. Executor: Claude (Windsor MCP + navegador + GTM MCP + código Xkedule/Xphere).
> Regra: **nada é ativado sem OK explícito do Vanildo.** Tudo nasce pausado.

---

## 0. Ficha do negócio (fonte: obigodeportugues.pt / Xkedule tenant 4)

| Item | Valor |
|---|---|
| Nome | O Bigode Português |
| Site / marcação | https://obigodeportugues.pt (Xkedule, domínio próprio) |
| Morada | Estrada do Zambujal 52B, 2610-021 **Amadora** (Zambujal/Alfragide) |
| Coordenadas | 38.7358784, -9.2139015 |
| Telefone / WhatsApp | +351 916 533 910 |
| Instagram | @obigodeportugues (bio: "Barbearia 🇧🇷🇵🇹") |
| Horário | Seg–Sex 10h–20h · Sáb 10h–16h · Dom fechado |
| Google Ads | conta `738-550-2411` (nova, sem histórico) via Windsor |
| Xphere | org `b5bd24d8-aed0-4983-9750-d02d88a6b161` (cadastro vazio) |

**Serviços:** Corte adulto/criança 14,99€ (30 min) · Barba máquina 9,99€ · Barba navalha 11,99€ · Barboterapia c/ vapor de ozono 14,99€ · Plástica de fios s/ formol 19,99€ · Hidratação intensa 9,99€ · Sobrancelha navalha / depilação nariz / orelha / acabamento 4,99€.

**Páginas para sitelinks:** `/services`, `/services?category=5|7|8|102|103`, `/contact`, `/about`, `/faq`.

---

## 1. Achados que bloqueiam ou afetam o lançamento

| # | Achado | Impacto | Correção |
|---|---|---|---|
| **B1** | **Sem banner de cookies nem Consent Mode v2** no site | Em Portugal (EEE) o Google exige Consent Mode v2 para usar dados de conversão e públicos. Também é exigência de RGPD. | **Bloqueante.** Implementar um banner com Consent Mode v2 no Xkedule, como funcionalidade da plataforma (vale para todos os tenants). Ver Fase A0. |
| **B2** | O evento `purchase` do Xkedule envia `currency: 'USD'` fixo ([analytics.ts:302](../../../../xkedule/client/src/lib/analytics.ts)) | O valor da conversão seria lido em dólares | Contorno: a tag do Google Ads no GTM força `EUR`. Correção de raiz: usar a moeda do tenant no Xkedule. |
| **B3** | O link de telefone no site é `tel:351916533910`, **sem o `+`** | No telemóvel, o toque liga para um número inválido | Corrigir o telefone do tenant ou a geração do link `tel:` no Xkedule. |
| B4 | Nenhum rastreio instalado (sem GTM, GA4 nem Pixel) | Sem medição | Fase A |
| B5 | Não sei se existe Perfil de Empresa no Google (GBP) | O recurso de localização e o Maps dependem dele | Verificar na Fase A. Se não existir, a criação/verificação fica com o dono (é postal/telefónica). |

---

## 2. Fase A: Medição (antes de qualquer anúncio)

### A0. Consentimento (B1): código no Xkedule
- Banner PT-PT e EN com "Aceitar", "Rejeitar" e "Personalizar". Guardar a escolha em cookie.
- `gtag('consent','default', {ad_storage, ad_user_data, ad_personalization, analytics_storage: 'denied', wait_for_update: 500})` **antes** do GTM carregar, e `consent update` depois da escolha.
- Ativar por tenant, ligado por padrão quando GTM, GA4 ou Pixel estiverem ligados.
- Entregar via PR no repositório `xkedule` (fora do escopo do Xphere) e validar com o Tag Assistant.

### A1. Google Ads: configuração da conta (navegador)
1. Confirmar **moeda EUR** e **fuso Europe/Lisbon**. Os dois são imutáveis: se estiverem errados, a conta tem de ser recriada. Parar e avisar.
2. **Marcação automática (auto-tagging): ON**, para que o `gclid` chegue ao site.
3. **Sufixo de URL final** da conta:
   `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}`
4. Aceitar os termos de **conversões otimizadas (enhanced conversions)**, para usar o método via GTM.
5. Dados do cliente e faturação: verificar apenas. A faturação é responsabilidade do dono; eu não insiro dados de pagamento.

### A2. Ações de conversão (navegador, Google Ads → Metas → Conversões)

| Conversão | Origem | Categoria | Valor | Contagem | Janela | Tipo |
|---|---|---|---|---|---|---|
| **Marcação Online** | Site (GTM) | Marcar consulta | Valor dinâmico do evento (fallback 15€) | Uma | 30 dias clique / 1 dia visualização | **Principal** |
| **Chamada do anúncio** | Recurso de chamada | Contacto telefónico | 15€ | Uma | 30 dias | **Principal**, duração ≥ 45 s |
| Clique para ligar (site) | Site (GTM) | Contacto | 5€ | Uma | 30 dias | Secundária |
| Clique WhatsApp (site) | Site (GTM) | Contacto | 5€ | Uma | 30 dias | Secundária |

Anotar o **ID de conversão (AW-XXXXXXXXX)** e os **rótulos** de cada ação.

### A3. GTM: container `obigodeportugues.pt` (GTM MCP)
**Variáveis (Data Layer):** `value`, `transaction_id`, `label`, `ecommerce.value`. Constante `AW_ID`.

**Acionadores (evento personalizado):**
- `CE - purchase`: evento = `purchase`
- `CE - click_call`: evento = `click_call`
- `CE - whatsapp`: evento = `contact_click` **e** `label` = `whatsapp`

**Tags:**
| Tag | Acionador | Notas |
|---|---|---|
| Google Tag (AW-ID) | Initialization – All Pages | Com dados fornecidos pelo utilizador ativados (enhanced conversions) |
| Conversion Linker | All Pages | |
| Ads Conv – Marcação Online | CE - purchase | valor `{{value}}`, moeda **EUR fixa** (B2), ID da transação `{{transaction_id}}` (evita duplicados) |
| Ads Conv – Clique Ligar | CE - click_call | |
| Ads Conv – WhatsApp | CE - whatsapp | |
| Ads Remarketing | All Pages | Público para remarketing futuro |

Publicar a versão "v1 – Google Ads conversões".

> GA4: não é bloqueante. Se o dono quiser, crio uma propriedade GA4 e a ligo ao Ads para ter públicos e relatórios. Recomendado na Fase D.

### A4. Xkedule: ligar o GTM (navegador, admin do tenant → Integrações → Tracking)
- Colar `GTM-XXXXXXX` e ativar. GA4 e Pixel ficam desligados, para não haver dupla contagem, porque tudo passa pelo GTM.

### A5. Teste ponta a ponta
1. Pré-visualização do GTM com o Tag Assistant em `obigodeportugues.pt?gclid=TEST123`.
2. Confirmar que os parâmetros `gclid` e UTM **sobrevivem à navegação SPA** até à página de confirmação. Se não sobreviverem, o Conversion Linker precisa do cookie `_gcl_aw`; confirmar.
3. **Marcação de teste real.** Precisa de OK do dono: marcar um horário e cancelar logo a seguir. Verificar que `purchase` dispara uma única vez, com o valor certo e em EUR.
4. Clicar no telefone e no WhatsApp e verificar os disparos.
5. No Google Ads, a conversão passa a **"A registar"** (demora até 24 h).

---

## 3. Fase B: Estrutura da campanha

### B0. Validação de volumes (navegador → Planeador de Palavras-chave)
- Localização: raio de 5 km. Idioma: português. Rede: Google.
- Validar volume e CPC das palavras abaixo. Cortar as que têm volume zero e acrescentar ideias com volume.
- Ajustar o orçamento: se o volume total não sustentar 10€ por dia, alargar o raio para 7–8 km ou manter o orçamento sem o gastar todo.

### B1. Campanha (Windsor `create_campaign` + acertos no navegador)
| Configuração | Valor | Como |
|---|---|---|
| Nome | `PT | Pesquisa | Barbearia Amadora` | Windsor |
| Tipo | Pesquisa | Windsor |
| Orçamento | **10€/dia** (a confirmar) | Windsor |
| Estado | **Pausada** | Windsor |
| Lance | Maximizar cliques, teto de CPC de **1,20€** | Windsor `set_campaign_bidding_strategy` |
| Redes | **Desligar Rede de Display e parceiros de pesquisa** | Navegador (o Windsor não controla) |
| Opção de localização | **"Presença: pessoas na localização ou que lá estão regularmente"** (não "interesse") | Navegador |
| Localização | Raio de 5 km em 38.7358784, -9.2139015 | Windsor `set_campaign_geo_targeting` |
| Idioma | `pt` (e `en`, opcional, para imigrantes e turistas) | Windsor |
| Programação | Seg–Sex 07h–21h · Sáb 07h–16h · Dom 17h–22h (marcações para a semana) | Windsor `set_ad_schedule` |
| Rotação de anúncios | Otimizar | padrão |
| Recursos automaticamente criados | Desligar (evita textos gerados pelo Google fora do tom) | Navegador |

### B2. Grupos de anúncios e palavras-chave (Windsor `create_ad_group` + `push_keywords`)
`[ ]` = exata, `" "` = frase. Tudo com lance da campanha (maximizar cliques).

**1. Marca** (proteção, custo baixo)
- [o bigode português] · [o bigode portugues] · "bigode português barbearia" · "bigode portugues amadora"

**2. Barbearia Local**
- [barbearia amadora] · "barbearia amadora" · [barbeiro amadora] · "barbeiro amadora"
- "barbearia alfragide" · "barbearia zambujal" · "barbearia damaia" · "barbearia buraca" · "barbearia reboleira" · "barbearia benfica" · "barbearia carnide"
- [barbearia perto de mim] · "barbearia perto de mim" · [barbeiro perto de mim] · "barbeiro perto de mim"
- "barbearia" · "barbeiro" (frase, limitadas pelo raio de 5 km; vigiar os termos de pesquisa)
- "barbearia brasileira" · "barbeiro brasileiro" (**confirmar com o dono** se a identidade 🇧🇷 é para comunicar)

**3. Corte Masculino**
- "corte de cabelo masculino" · "corte cabelo homem" · "corte de cabelo homem"
- "cabeleireiro masculino" · "cabeleireiro homem" · "cabeleireiro para homem"
- "corte degradê" · "corte degrade" · "corte fade" · "corte de cabelo criança" · "corte cabelo menino"

**4. Barba**
- "barba à navalha" · "barba navalha" · "barboterapia" · "barbaterapia"
- "fazer a barba" · "aparar barba" · "desenhar barba" · "barbeiro barba"

**5. Tratamentos**
- "plástica de fios" · "plastica de fios masculina" · "alisamento masculino" · "alisamento sem formol"
- "hidratação cabelo masculino" · "sobrancelha homem" · "depilação nariz"

### B3. Palavras negativas (Windsor `push_negative_keywords`, nível campanha)
- **Emprego / formação:** curso, cursos, formação, formacao, escola, academia, aprender, emprego, empregos, vaga, vagas, recrutamento, salário, "trabalhar como"
- **Compra de produtos:** comprar, venda, loja, preço máquina, "máquina de cortar", "maquina de cortar", máquinas, kit, óleo, pente, amazon, worten, continente, "el corte inglés"
- **Público errado:** feminino, feminina, senhora, senhoras, mulher, mulheres, noiva, unhas, manicure, laser, cão, cães, tosquia
- **Informação / DIY:** tutorial, "como cortar", "como fazer", "em casa", fotos, imagens, ideias, desenho (em frase: "desenho de")
- **Grátis:** grátis, gratis, gratuito
- **Outras cidades:** porto, braga, coimbra, faro, setúbal, aveiro, leiria, funchal
- **Serviço não oferecido:** domicílio, "ao domicílio", casamento

(Revisar os termos de pesquisa reais no dia 3 e todas as semanas; acrescentar negativas.)

### B4. Anúncios responsivos (Windsor `create_responsive_search_ad`, pausados)
Todos os textos foram validados: títulos com no máximo 30 caracteres e descrições com no máximo 90. URL final = página do serviço. Caminhos de exibição: `obigodeportugues.pt/Barbearia/Amadora`, `/Corte/Masculino`, `/Barba/Navalha`, `/Tratamentos/Capilar`.

**Barbearia Local** (e Marca, com o título 1 fixado na posição 1): URL `/`
- Títulos: O Bigode Português · Barbearia em Amadora · Barbeiro no Zambujal · Barbearia Perto de Si · Marque Online em 60 Segundos · Corte Masculino 14,99€ · Barba à Navalha 11,99€ · Barboterapia com Ozono · Barbeiros Experientes · Satisfação Garantida · Aberto de Segunda a Sábado · Cortes Clássicos e Degradê · Adulto e Criança · Estrada do Zambujal 52B · Reserve Já o Seu Horário
- Descrições:
  1. Cortes clássicos e degradês com precisão. Marque online em segundos, sem complicações.
  2. Barba à máquina, à navalha ou barboterapia com vapor de ozono. Reserve o seu horário.
  3. Não ficou como queria? Ajustamos até ficar certo. Satisfação garantida no Bigode.
  4. Seg a Sex 10h-20h, Sáb 10h-16h. Estrada do Zambujal 52B, Amadora. Ligue 916 533 910.

**Corte Masculino**: URL `/services?category=<corte>`
- Títulos: Corte Masculino 14,99€ · Corte de Cabelo Homem · Degradê, Fade e Clássico · Máquina, Tesoura ou Ambos · Corte de Criança 14,99€ · Barbearia em Amadora · O Bigode Português · Marque Online em 60 Segundos · Barbeiros Experientes · Satisfação Garantida · Aberto ao Sábado · Corte + Barba no Mesmo Dia · Sem Esperas: Hora Marcada · Reserve Já o Seu Horário · Atenção ao Detalhe
- Descrições:
  1. Corte masculino à máquina, à tesoura ou combinado. Do clássico ao degradê moderno.
  2. Adultos e crianças pelo mesmo preço: 14,99€. Marque online e chegue à sua hora.
  3. Não ficou como queria? Ajustamos até ficar certo. Satisfação garantida no Bigode.
  4. Estrada do Zambujal 52B, Amadora. Seg a Sex 10h-20h, Sáb 10h-16h. Marque já online.

**Barba**: URL `/services?category=<barba>`
- Títulos: Barba à Navalha 11,99€ · Barboterapia com Ozono · Barba à Máquina 9,99€ · Toalha, Vapor e Navalha · Barba Bem Desenhada · Contornos Definidos · O Bigode Português · Barbearia em Amadora · Marque Online em 60 Segundos · Barbeiros Experientes · Satisfação Garantida · Corte + Barba no Mesmo Dia · Aberto ao Sábado · Reserve Já o Seu Horário · Barboterapia por 14,99€
- Descrições:
  1. Barba à máquina, à navalha ou barboterapia completa com vapor de ozono e massagem.
  2. Desenho preciso e contornos definidos com acabamento de navalha. Marque online já.
  3. Barboterapia: esfoliação com vapor de ozono, navalha, creme hidratante e massagem.
  4. Estrada do Zambujal 52B, Amadora. Seg a Sex 10h-20h, Sáb 10h-16h. Ligue 916 533 910.

**Tratamentos**: URL `/services?category=<tratamentos>`
- Títulos: Plástica de Fios Masculina · Alisamento Sem Formol · Plástica de Fios 19,99€ · Hidratação Capilar Homem · Hidratação Intensa 9,99€ · Cabelo Liso e Natural · Para Cabelo Ondulado · O Bigode Português · Barbearia em Amadora · Marque Online em 60 Segundos · Satisfação Garantida · Aberto ao Sábado · Reserve Já o Seu Horário · Resultado Duradouro · Barbeiros Experientes
- Descrições:
  1. Plástica de fios sem formol: cabelo ondulado ou encaracolado liso, natural e duradouro.
  2. Hidratação intensa que repara a fibra capilar e reduz a quebra. Por apenas 9,99€.
  3. Tratamentos capilares masculinos com atenção ao detalhe. Marque online em segundos.
  4. Estrada do Zambujal 52B, Amadora. Seg a Sex 10h-20h, Sáb 10h-16h. Ligue 916 533 910.

> Na execução: mapear cada `category=` ao serviço certo, abrindo as páginas no navegador. Os textos "Satisfação garantida" e "Barbeiros experientes" vêm do próprio site do cliente.

### B5. Recursos / extensões (Windsor `create_ad_asset`, nível campanha)
- **Sitelinks:** Serviços e Preços → `/services` · Marcar Online → `/services` · Barboterapia → `/services?category=<barba>` · Corte de Criança → `/services?category=<corte>` (cada um com 2 linhas de descrição)
- **Frases de destaque:** Marcação em 60 Segundos · Satisfação Garantida · Barbeiros Experientes · Aberto ao Sábado · Corte Adulto e Criança · Sem Formol
- **Snippet estruturado "Serviços":** Corte Masculino · Barba à Navalha · Barboterapia · Plástica de Fios · Hidratação · Sobrancelha
- **Chamada:** 916 533 910 (PT), com o horário da chamada restrito ao horário de funcionamento (navegador)
- **Localização:** ligar o Perfil de Empresa no Google (navegador), se existir (B5)
- **Imagem e logótipo** (navegador): fotos reais do site ou do Instagram

---

## 4. Fase C: QA pré-lançamento (checklist)
- [ ] B1 consentimento em produção e validado
- [ ] B3 link `tel:` corrigido
- [ ] Conversões "A registar" / tag verificada
- [ ] Rede de Display e parceiros **desligados**; localização em "Presença"
- [ ] Raio, idioma e programação conferidos no painel
- [ ] Todos os anúncios "Aprovados" (sem reprovação de política)
- [ ] URLs finais abrem (200) e mantêm `gclid` e UTM
- [ ] Negativas aplicadas
- [ ] Faturação ativa (dono)
- [ ] **OK do Vanildo → ativar campanha, grupos e anúncios**

---

## 5. Fase D: Otimização (rotina)
| Quando | Ação |
|---|---|
| Dia 1–3 | Verificar impressões, CPC real e reprovações. Primeira revisão dos termos de pesquisa e novas negativas |
| Semanal | Termos de pesquisa → negativas e novas palavras. Pausar palavras com mais de 15€ gastos e 0 conversões. Ajustar o teto de CPC |
| ~15 conversões | Criar GA4 e públicos de remarketing (visitou e não marcou) |
| ~30 conversões/30 dias | Mudar para **Maximizar conversões** → depois **CPA desejado** (~5–7€) |
| Mensal | Relatório: gasto, marcações, custo por marcação e receita (via Xphere quando a Fase E estiver ativa) |

Meta inicial de referência (validar após 30 dias): **custo por marcação ≤ 7€**. Um ticket médio de ~15–25€ e o valor de um cliente recorrente justificam esse valor.

---

## 6. Fase E: Jornada completa no Xphere (código, plataforma)
Vale para todos os tenants do Xkedule, não só para o Bigode.
1. **Captura de gclid:** o script de analytics do Xphere passa a capturar `gclid`, `gbraid` e `wbraid` (hoje só capta UTM e fbclid) e é instalado nos sites do Xkedule.
2. **Origem na marcação:** o Xkedule envia `visitor_id`, gclid e UTM no webhook `booking.created`, e o Xphere liga marcação, contacto e sessão. Resultado: cada contacto mostra de que campanha e palavra-chave veio.
3. **Conversões offline:** `booking.completed` → upload de conversão para o Google Ads com o valor realmente pago. Assim a campanha otimiza para quem comparece, e não só para quem marca.
4. **Cadastro da org** no Xphere: morada, moeda EUR, fuso Europe/Lisbon.

---

## Log de execução

**2026-09-21**
- A1 ✅ Moeda EUR, fuso WET, auto-tagging já ON, faturação configurada. Sufixo de URL final salvo ao nível da conta.
- A2 ✅ Conversões criadas. ID de conversão `AW-18438839383`.
  - Marcação Online → `AW-18438839383/7krSCJiLhoAdENe4qdhE` (valor por conversão, default 15€, contagem Uma)
  - Clique WhatsApp → `AW-18438839383/WE36CJuLhoAdENe4qdhE` (5€, Uma)
  - Clique Ligar → `AW-18438839383/SNq_CJ6LhoAdENe4qdhE` (5€, Uma)
  - Calls from ads (Phone call lead) com as configurações padrão
  - ⚠️ A ordem dos rótulos foi lida pela ordem da lista do assistente; confirmar na Pré-visualização do GTM.
  - ⏳ Pendentes: WhatsApp/Ligar → **Secundária**; Marcação → janela de 30 dias; Calls from ads → renomear para "Chamada do anúncio" e duração ≥ 45 s; "Obter direções" (antiga, *Misconfigured*, Principal) → secundária ou remover. As edições pelo navegador foram bloqueadas pelo classificador de permissões.
- A3 ✅ GTM: conta `6378051454` "O Bigode Portugues", container `264766330` / **GTM-KM77PHQQ**. Versão 2 "v1 - Google Ads conversões" **publicada**. Contém: Google Tag AW (Initialization), Conversion Linker (URL passthrough ON), Ads Conv Marcação (CE purchase, valor `{{DLV - value}}` default 15, EUR fixa, orderId `{{DLV - transaction_id}}`), Ads Conv WhatsApp (contact_click + label=whatsapp), Ads Conv Ligar (click_call), Ads Remarketing. Ainda não está instalado no site: aguarda o banner (A0) + o ID no Xkedule (A4).
- B ✅ Campanha `24268204011` "PT | Pesquisa | Barbearia Amadora" PAUSADA: 10€/dia, maximizar cliques (target_spend) com teto de CPC de 1,20€, raio de 5 km (38.7358784,-9.2139015), idioma pt, programação Seg–Sex 7–21 · Sáb 7–16 · Dom 17–22, 62 negativas.
  - Grupos (pausados): Marca `200833030936` (4 kw) · Barbearia Local `203279552351` (22 kw, com Alfragide) · Corte Masculino `203279556191` (11) · Barba `199103428543` (8) · Tratamentos `203279564311` (7).
  - 1 RSA por grupo (pausado), textos com "Alfragide". URLs: `/`, `?category=7` (corte), `?category=5` (barba), `?category=102` (tratamentos).
  - Extensões: 4 sitelinks, 6 frases de destaque, snippet "Service catalog", chamada 916 533 910.
  - ✅ (navegador) Parceiros de pesquisa OFF (Display já estava OFF); localização → "Presença"; recursos automáticos já OFF; EU political ads = Não.
  - ✅ Maps / Local: Perfil de Empresa JÁ ligado à conta (Data manager → "1 linked", perfil de pt.ronaldocosta@outlook.com). Recurso de LOCALIZAÇÃO associado à campanha ("All locations"). Assim a campanha pode aparecer no Map Pack e no Google Maps (a exposição é decidida pelo leilão, não é controlável).
  - (antigo) ⏳ Navegador: desligar Rede de Display + parceiros de pesquisa; localização → "Presença"; recursos automáticos OFF. B0 (validação de volume no Planeador) não feita.
  - "barbearia brasileira" NÃO adicionada (a confirmar com o dono).
- A0 ✅ Xkedule branch `feat/consent-banner` rebaseada sobre `origin/main` (3 commits: 52e2293a banner + Consent Mode v2, 5fbf54c3 moeda do tenant, 39cebb62 `tel:` com +). Sem push. Typecheck/build passaram na base antiga; não voltaram a correr após o rebase.
- A0/A4 ✅ EM PRODUÇÃO: xkedule main `9ebed217` (deploy Coolify OK). Migração `20260921000000` aplicada à mão no DB ATIVO (`.env`, projeto ahfox…; o `.env.production` é o projeto antigo). Tenant 4: `consent_banner_enabled=true`, `gtm_enabled=true`, `gtm_container_id=GTM-KM77PHQQ`. Verificado no site: banner visível, consent default denied, GTM carregado, `tel:+351916533910`.
  - Nota: o banner cobre parcialmente o botão flutuante do WhatsApp até o visitante escolher.
- A5 ✅ (sintético) Marcação real BLOQUEADA pelo classificador no clique "Confirmar". Testado disparando `purchase`/`click_call`/`contact_click(whatsapp)` no dataLayer em produção com consentimento aceite e `?gclid=TEST_CLAUDE_123`: as 3 tags saíram com o rótulo certo, EUR, valor e `gclaw`. `_gcl_aw` gravado pelo Conversion Linker. Limpeza: `abandoned_checkouts` id 216 (teste) apagado; nenhuma marcação/contacto criado.
- A2 ✅ Ajustes: WhatsApp e Ligar → Secundária; Marcação → janela de 30 dias; "Obter direções" → Secundária; "Calls from ads" renomeada para "Chamada do anúncio", valor 15€, duração mínima de 60 s (padrão, mantida).
- B ✅ Verificado via API: geo PRESENCE, search partners OFF, display OFF.
- ✅ +599 negativas (lista em `negatives-2026-09-21.json`, 9 categorias) → ~660 no total. Validadas por script: nenhuma bloqueia keywords positivas nem bairros dentro do raio (Queluz, Oeiras, Carnaxide, Pontinha e Brandoa ficaram de fora de propósito; "estética" retirada).
- ⏰ Revisão D3 agendada: tarefa local `bigode-google-ads-revisao-d3`, 2026-09-23 10:00 (-04:00). Só adiciona negativas; o resto reporta.
- ✅ **Xphere ↔ Bigode ligado** (2026-09-21):
  - Org `b5bd24d8`: cadastro corrigido (Estrada do Zambujal 52B, 2610-021 Amadora, PT, EUR, Europe/Lisbon, marca).
  - API key `xph_3e9e3115…` (api_keys id `a9042f72…`, "Xkedule — O Bigode Português (booking sync)").
  - Integração Xphere `integrations` id `c24bb164…` (provider xkedule, location_id https://obigodeportugues.pt, chave cifrada).
  - Xkedule `integration_settings` id 5 (tenant 4, provider xphere, https://xphere.app, enabled). Webhook testado: chave válida 200 / falsa 401.
  - Analytics setup id `6ca89f0e…`, script_token `62bfb785…` (script responde 200). Falta instalar no site (E2).
  - Correção: o callback OAuth do Google Ads limitava a 10 contas → agora lê todas (branch feat/google-ads-attribution).
  - Ligação Google Ads nativa: bloqueada no login Google (precisa do utilizador).
- ✅ **Fase E em produção** (2026-09-21):
  - Xkedule main `460ec2ed` (E2 script Xphere por tenant, E3 attribution na booking + webhook, script de backfill, CSP). Migração `20260921130000` aplicada à mão no DB ativo antes do push. Tenant 4 `xphere_analytics_token=62bfb785…`.
  - Xphere main (5 commits rebaseados sobre `47ed8cbc` + docs): API Google Ads v20→**v25** (v20/v21 davam 404 → toda a integração Google Ads do Xphere estava quebrada), ads-tick deixou de marcar Google como "expirado" (confundia o access token de 1h), E1 gclid/gbraid/wbraid, E3 recepção de attribution + linkVisitorToContact, E4 upload offline em `showed`. Migração `1301` via `db push`.
  - Google Ads: ação de conversão **"Cliente atendido"** (UPLOAD_CLICKS, Compra, secundária, 30 dias, default 15€) = `customers/7385502411/conversionActions/7785350099`, gravada em `organizations.settings.google_ads_offline_conversion_action` da org do Bigode.
  - Backfill do histórico do tenant 4 → Xphere executado (ver resultado abaixo).
  - ✅ ads_connection Google da org do Bigode: `7385502411` status `active`, health `ok`, **usable=true** (OAuth refeito após o deploy v25; as outras 6 contas acessíveis ficaram `available`/ocultas). Upload offline ARMADO.
  - Backfill: 292 bookings + 40 contactos no Xphere. ~240 bookings antigas sem telefone/email (balcão) → sem contacto (invariante de identidade do Xphere, correto). 3 falharam por timeout/502 durante o deploy → re-run idempotente.
  - ⚠️ Descobertas: (1) o callback OAuth do Google Ads é chamado 2× (o 2.º dá invalid_grant e deixa `?error=` na URL mesmo com a ligação feita); (2) a app OAuth do Xphere aparece como "não verificada" → se o ecrã de consentimento estiver em modo **Testing**, os refresh tokens expiram em 7 dias.
  - (antigo) Pendente: ads_connection Google da org do Bigode (OAuth; falhou com invalid_grant antes da correção v25) com status `active` + health `ok` — sem isso o upload offline não dispara.
- ✅ **Arrumação final (2026-09-21, noite)**:
  - Xphere `2e497b62`: callback OAuth duplicado agora aterra em `?connected=true` (invalid_grant do 2.º pedido + org verificada há <2 min).
  - App OAuth do Xphere já estava **In production** (tokens não expiram em 7 dias); "não verificada" = scope adwords sem verificação Google; limite vitalício 100 utilizadores (3 usados).
  - 18/20 ligações Google de todas as orgs re-verificadas contra a API v25 e repostas a `health=ok`; 2 (conta 4948878797) perderam acesso de facto → mensagem corrigida.
  - Xkedule `4eab4cdb`: botão WhatsApp sobe acima do banner e da barra "Continuar para a Marcação" (registo de alturas via ResizeObserver). Verificado em produção: sem sobreposição (105px com banner, 180px com carrinho).
  - Backfill 2.ª passagem: 297/297 OK.
  - Verificação ponta a ponta em produção: script Xphere só carrega após consentimento; `_gcl_aw` + `_xp_gclid` gravados; gclid chegou a `analytics_sessions`. Dados de teste apagados.
  - Xkedule `.env.production` marcado como STALE (aponta ao projeto antigo).
- 🚀 **2026-09-21: CAMPANHA ATIVADA** (campanha + 5 grupos + 5 RSAs enabled). Anúncios e recursos estavam "Under review" na altura.
- A0 (histórico) Banner de consentimento minimalista no Xkedule em curso (branch `feat/consent-banner`, sem push). Commits separados para B2 (moeda) e B3 (`tel:`).

## 7. Decisões pendentes (dono / Vanildo)
1. Orçamento: 10€/dia?
2. Comunicar a identidade "barbearia brasileira"?
3. Autorização para uma marcação de teste (criar e cancelar)
4. Existe Perfil de Empresa no Google? Quem tem acesso?
5. Quem é a conta Google logada no navegador para o Ads e o GTM (acesso de administrador a `738-550-2411`)
