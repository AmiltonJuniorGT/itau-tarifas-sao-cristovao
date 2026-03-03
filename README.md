# Dashboard — Tarifas/Taxas Itaú (URL com filtros)

Esta tela lê **um CSV público** (ex.: Google Sheets publicado) e monta:
- Resumo mensal por **denominação** (heatmap)
- Evolução total mensal + **mediana móvel (3 meses)**
- Flag de meses “acima da curva” (limiar configurável, default 1.20×)
- Gráfico por denominação (até 10 séries — use filtro para reduzir)
- Lista de lançamentos filtrados

## Como colocar no ar (URL) via GitHub Pages
1) Crie um repositório no GitHub (ex.: `itau-tarifas-sao-cristovao`)
2) Suba estes arquivos:
   - `index.html`
   - `styles.css`
   - `app.js`
3) Vá em **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main` / folder: `/root`
4) Salve. Sua URL ficará algo como:
   `https://SEUUSUARIO.github.io/NOME-DO-REPO/`

## Como gerar um CSV público (Google Sheets)
### Opção A (recomendada): Google Sheets publicado como CSV
1) Abra a planilha no Google Sheets
2) **Arquivo → Publicar na Web**
3) Escolha a aba com lançamentos e formato **CSV**
4) Copie o link gerado e cole no campo **CSV_URL** na tela

> Dica: se o CSV for do extrato Itaú, mantenha colunas como: `Data`, `Lançamento`, `Valor (R$)`
> (a tela tenta detectar o cabeçalho automaticamente).

### Opção B: CSV dentro do próprio repo
- Coloque um arquivo `dados.csv` no repo e use:
  `https://SEUUSUARIO.github.io/NOME-DO-REPO/dados.csv`

## Ajustar classificação (denominação)
Edite a função `categorize()` em `app.js` para agrupar do jeito que você quer.

## Ajustar o que entra/saí (filtro textual)
Edite:
- `INCLUDE_RE` (o que considerar como tarifa/taxa)
- `EXCLUDE_RE` (o que excluir, ex.: pagamentos, sispag etc.)

---
Se você me mandar o CSV/Sheet do **São Cristóvão**, eu já devolvo o pacote com:
- `DEFAULT_CSV_URL` preenchida
- Regras de classificação ajustadas conforme seus lançamentos.


## CSV padrão já configurado (São Cristóvão)
Este projeto já vem com `DEFAULT_CSV_URL` apontando para:

https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/export?format=csv&gid=1092717054
