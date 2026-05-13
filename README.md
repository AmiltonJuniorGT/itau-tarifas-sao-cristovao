# Dashboard Itaú — Tarifas e Taxas Multiunidade

Dashboard estático em HTML, CSS e JavaScript puro para análise mensal de tarifas/taxas bancárias por unidade.

## URL do GitHub Pages

Repositório atual:

```txt
itau-tarifas-sao-cristovao
```

URL esperada:

```txt
https://amiltonjuniorgt.github.io/itau-tarifas-sao-cristovao/
```

Exemplos com parâmetros:

```txt
https://amiltonjuniorgt.github.io/itau-tarifas-sao-cristovao/?u=SC,CAJ,CAM,GAMA&mode=sum
```

```txt
https://amiltonjuniorgt.github.io/itau-tarifas-sao-cristovao/?u=SC,CAJ,CAM,GAMA&mode=compare
```

---

## Arquivos do projeto

O projeto usa apenas 3 arquivos principais:

```txt
index.html
styles.css
app.js
```

Este README é apenas documentação.

---

## Estrutura esperada das planilhas

Cada unidade deve ter uma aba pública no Google Sheets no formato pivot:

```txt
Denominação | 2023-02 | 2023-03 | 2023-04 | ...
```

- A primeira coluna deve conter a descrição da despesa/tarifa.
- As demais colunas devem ser meses no formato `YYYY-MM`.
- As células devem conter valores mensais.
- Os valores podem estar positivos ou negativos; o dashboard trata os valores como magnitude positiva.

---

## Unidades configuradas

As unidades estão cadastradas no `app.js`, no bloco `UNITS`:

```js
const UNITS = [
  {
    key: "SC",
    name: "São Cristóvão BA",
    csv: "https://docs.google.com/spreadsheets/d/1g9rTDldOUzgcVWKrvw1IGZ2RlhItF5gh/gviz/tq?tqx=out:csv&gid=1092717054"
  },
  {
    key: "CAJ",
    name: "Cajazeiras BA",
    csv: "https://docs.google.com/spreadsheets/d/1dPt6Y1Mb1Yrzb0e3Z9U7Mc0fcVBVmcHq/gviz/tq?tqx=out:csv&gid=1825385594"
  },
  {
    key: "CAM",
    name: "Camaçari BA",
    csv: "https://docs.google.com/spreadsheets/d/1d5LLNN1lShh61EHxS93vCuFKzTH3qwcM/gviz/tq?tqx=out:csv&gid=551763344"
  },
  {
    key: "GAMA",
    name: "Gama - DF",
    csv: "https://docs.google.com/spreadsheets/d/19rLjRfy8HLoYY2o3DaRuNb2uNod20iLm/gviz/tq?tqx=out:csv&gid=285444437"
  }
];
```

---

## Como adicionar uma nova unidade

1. Crie a planilha/aba no Google Sheets no mesmo formato pivot.
2. Compartilhe a planilha como pública.
3. Copie o ID da planilha e o `gid` da aba.
4. Monte a URL GVIZ:

```txt
https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/gviz/tq?tqx=out:csv&gid=GID_DA_ABA
```

5. Adicione um novo objeto no array `UNITS` do `app.js`:

```js
{
  key: "NOVA",
  name: "Nova Unidade",
  csv: "https://docs.google.com/spreadsheets/d/ID_DA_PLANILHA/gviz/tq?tqx=out:csv&gid=GID_DA_ABA"
}
```

---

## Parâmetros da URL

O dashboard aceita parâmetros na URL:

### Unidades

```txt
?u=SC,CAJ,CAM,GAMA
```

### Modo consolidado

```txt
&mode=sum
```

### Modo comparativo

```txt
&mode=compare
```

Exemplo:

```txt
https://amiltonjuniorgt.github.io/itau-tarifas-sao-cristovao/?u=SC,CAJ,CAM,GAMA&mode=sum
```

---

## Funcionalidades

- Seleção de uma ou mais unidades.
- Modo consolidado: soma as unidades selecionadas.
- Modo comparativo: mostra linhas separadas por unidade no gráfico principal.
- Filtro por período.
- Filtro por denominação/despesa.
- Gráfico de total mensal.
- Mediana móvel de 3 meses.
- Sinalização de meses acima da curva.
- Heatmap mensal por denominação.
- Ranking de despesas.
- Exportação CSV do resumo.

---

## Publicação no GitHub Pages

No GitHub:

1. Acesse o repositório.
2. Envie/substitua os arquivos:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md`
3. Vá em:

```txt
Settings → Pages
```

4. Configure:

```txt
Source: Deploy from a branch
Branch: main
Folder: /root
```

5. Aguarde alguns segundos.
6. Acesse:

```txt
https://amiltonjuniorgt.github.io/itau-tarifas-sao-cristovao/
```

---

## Cache

Após cada alteração, use:

```txt
Cmd + Shift + R
```

no Mac para forçar atualização da página.

Se ainda carregar versão antiga, abra em aba anônima.

---

## Observações importantes

- As planilhas precisam estar públicas.
- O cabeçalho deve conter `Denominação`.
- Os meses devem estar no formato `YYYY-MM`.
- Se uma unidade falhar, o dashboard tentará carregar as demais e mostrará aviso no topo.
