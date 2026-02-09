# GPXtruder Modern

Converta trilhas GPS (arquivos GPX) em modelos 3D imprimíveis (STL). Todo o processamento acontece no navegador — nenhum dado é enviado para servidores.

## Funcionalidades

- **Upload de GPX** via drag & drop ou seleção de arquivo
- **Trilha de exemplo** inclusa para teste imediato
- **Preview 3D interativo** via WebGL (rotação, pan, zoom)
- **Download STL** para impressão 3D
- **3 estilos de modelo**: Mapa (trajeto 2D), Linear (perfil reto), Anel (perfil circular)
- **Projeções cartográficas**: Google Maps, UTM, personalizada (proj4)
- **Marcadores de distância**: km, milhas ou intervalo personalizado
- **Suavização automática** ou manual da trilha
- **Exagero vertical** configurável
- **Código paramétrico** para OpenJSCAD e OpenSCAD
- **Tema claro/escuro**
- **Design responsivo** (desktop e mobile)
- Interface em **português do Brasil**

## Como Usar

1. Abra `index.html` no navegador
2. Arraste um arquivo `.gpx` ou clique em "Usar trilha de exemplo"
3. Ajuste as opções de rota, modelo e tamanho conforme desejado
4. Clique em **"Gerar Modelo 3D"**
5. Use o preview 3D para inspecionar o modelo
6. Clique em **"Baixar STL"** para download

## Dependências

A única dependência externa é a biblioteca **proj4.js** para projeções cartográficas.

Você precisa copiá-la para `js/lib/`:

```
js/lib/proj4.min.js
```

Fontes para o proj4.js:
- CDN: https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.min.js
- npm: `npm install proj4` e copiar o arquivo de dist
- Repositório original: https://github.com/anoved/gpxtruder/tree/gh-pages/js

## Deploy

### GitHub Pages

1. Faça push do projeto para um repositório GitHub
2. Vá em Settings > Pages
3. Selecione a branch `main` e a pasta `/` (root)
4. O site estará disponível em `https://seuusuario.github.io/seurepositorio/`

### Netlify

1. Arraste a pasta do projeto no painel do Netlify
2. Ou conecte o repositório GitHub para deploy automático
3. Não é necessário build — é um site estático

### Qualquer servidor web

Copie todos os arquivos para o diretório raiz do servidor. Funciona em qualquer servidor que sirva arquivos estáticos (Apache, Nginx, Python http.server, etc.).

## Estrutura do Projeto

```
gpxtruder-modern/
├── index.html              # Página principal
├── css/
│   └── style.css           # Estilos (tema claro/escuro, responsivo)
├── js/
│   ├── app.js              # Aplicação principal (coordena tudo)
│   ├── gpx-parser.js       # Parser de arquivos GPX
│   ├── model-generator.js  # Geração do modelo 3D (geometria)
│   ├── preview-3d.js       # Preview WebGL interativo
│   ├── utils.js            # Vincenty, projeções, helpers
│   └── lib/
│       └── proj4.min.js    # Projeções cartográficas (dependência)
├── gpx/
│   └── sample.gpx          # Trilha de exemplo (Serra do Mar)
└── README.md
```

## Créditos

Este projeto é uma versão modernizada do **[GPXtruder](https://github.com/anoved/gpxtruder)** criado por **[Jim DeVona](https://github.com/anoved)**.

O GPXtruder original converte trilhas GPS em modelos 3D e está disponível em [gpxtruder.xyz](https://gpxtruder.xyz/).

### Bibliotecas utilizadas no original:
- [proj4js](http://proj4js.org/) — projeções cartográficas
- [Vincenty's formulae](https://en.wikipedia.org/wiki/Vincenty%27s_formulae) — cálculo de distâncias geodésicas

## Licença

MIT License — Veja o projeto original para detalhes completos.
