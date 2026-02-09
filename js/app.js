/**
 * app.js - Aplicação principal do GPXtruder Modern
 *
 * Coordena a interação entre UI, parser GPX, gerador de modelo 3D
 * e preview WebGL. Todo processamento é feito no navegador.
 */

(function () {
    'use strict';

    // ============================================================
    // ESTADO DA APLICAÇÃO
    // ============================================================

    const state = {
        gpxData: null,      // Pontos do GPX carregado [lon, lat, ele][]
        gpxInfo: null,      // Informações do GPX (nome, dist, etc.)
        modelResult: null,  // Resultado da geração do modelo
        preview: null,      // Instância do Preview3D
        currentTheme: 'dark'
    };

    // ============================================================
    // REFERÊNCIAS DOM
    // ============================================================

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        // Upload
        dropZone: $('#drop-zone'),
        gpxFile: $('#gpx-file'),
        btnSample: $('#btn-sample'),
        gpxInfo: $('#gpx-info'),
        gpxName: $('#gpx-name'),
        gpxDistance: $('#gpx-distance'),
        gpxPoints: $('#gpx-points'),
        gpxEleMin: $('#gpx-ele-min'),
        gpxEleMax: $('#gpx-ele-max'),
        gpxGain: $('#gpx-gain'),
        gpxLoss: $('#gpx-loss'),
        gpxNoElevation: $('#gpx-no-elevation'),

        // Opções de rota
        verticalSlider: $('#vertical-slider'),
        vertical: $('#vertical'),
        zcut: $('#zcut'),
        zoverride: $('#zoverride'),
        zconstant: $('#zconstant'),
        smoothRadios: $$('input[name="smooth"]'),
        mindist: $('#mindist'),

        // Opções de modelo
        shapeBtns: $$('.shape-btn'),
        projRadios: $$('input[name="proj_type"]'),
        projection: $('#projection'),
        regionfit: $('#regionfit'),
        regionInputs: $('#region-inputs'),
        eastMin: $('#east_min'),
        eastMax: $('#east_max'),
        northMin: $('#north_min'),
        northMax: $('#north_max'),
        markerRadios: $$('input[name="marker"]'),
        markerInterval: $('#marker_interval'),

        // Tamanho
        width: $('#width'),
        depth: $('#depth'),
        pathWidth: $('#path_width'),
        base: $('#base'),

        // Gerar
        btnGenerate: $('#btn-generate'),
        progressContainer: $('#progress-container'),
        progressFill: $('#progress-fill'),
        progressText: $('#progress-text'),

        // Preview
        previewContainer: $('#preview-container'),
        previewControls: $('#preview-controls'),
        viewBtns: $$('.btn-view'),

        // Downloads
        outputDownloads: $('#output-downloads'),
        btnDownloadStl: $('#btn-download-stl'),

        // Código
        outputCode: $('#output-code'),
        codeJscad: $('#code-jscad'),
        codeOscad: $('#code-oscad'),
        codeTabs: $$('.code-tab'),
        btnCopyCode: $('#btn-copy-code'),

        // Mensagens
        messages: $('#messages'),

        // Tema
        btnTheme: $('#btn-theme')
    };

    // ============================================================
    // INICIALIZAÇÃO
    // ============================================================

    function init() {
        setupTheme();
        setupDropZone();
        setupCollapsibles();
        setupControls();
        setupGenerate();
        setupPreviewControls();
        setupCodeTabs();
        setupCopyButton();
    }

    // ============================================================
    // TEMA CLARO/ESCURO
    // ============================================================

    function setupTheme() {
        const saved = localStorage.getItem('gpxtruder-theme');
        if (saved) {
            state.currentTheme = saved;
        }
        document.documentElement.setAttribute('data-theme', state.currentTheme);

        dom.btnTheme.addEventListener('click', () => {
            state.currentTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', state.currentTheme);
            localStorage.setItem('gpxtruder-theme', state.currentTheme);
        });
    }

    // ============================================================
    // DRAG & DROP / UPLOAD DE GPX
    // ============================================================

    function setupDropZone() {
        const zone = dom.dropZone;

        // Clique na zona abre o file picker
        zone.addEventListener('click', () => dom.gpxFile.click());

        // Drag events
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        // File input change
        dom.gpxFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        // Botão de exemplo
        dom.btnSample.addEventListener('click', loadSample);
    }

    /**
     * Processa um arquivo GPX selecionado ou arrastado.
     * @param {File} file
     */
    function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.gpx')) {
            showMessage('Por favor, selecione um arquivo .gpx válido.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            processGPXText(e.target.result);
        };
        reader.onerror = () => {
            showMessage('Erro ao ler o arquivo.', 'error');
        };
        reader.readAsText(file);
    }

    /**
     * Carrega o arquivo GPX de exemplo.
     */
    function loadSample() {
        const req = new XMLHttpRequest();
        req.onreadystatechange = function () {
            if (req.readyState === 4) {
                if (req.status === 200 || req.status === 0) {
                    processGPXText(req.responseText);
                } else {
                    showMessage('Erro ao carregar o arquivo de exemplo.', 'error');
                }
            }
        };
        req.open('GET', 'gpx/sample.gpx', true);
        req.send();
    }

    /**
     * Processa o texto GPX: faz parsing e exibe informações.
     * @param {string} text
     */
    function processGPXText(text) {
        clearMessages();

        const forceElev = dom.zoverride.checked;
        const defaultElev = parseFloat(dom.zconstant.value) || 100;

        const result = GPXParser.parse(text, forceElev, defaultElev);

        if (result.error) {
            showMessage(result.error, 'error');
            state.gpxData = null;
            state.gpxInfo = null;
            dom.gpxInfo.classList.add('hidden');
            dom.btnGenerate.disabled = true;
            return;
        }

        state.gpxData = result.points;
        state.gpxInfo = result.info;

        displayGPXInfo(result.info);
        dom.btnGenerate.disabled = false;
        showMessage(`Trilha "${result.info.name}" carregada com sucesso!`, 'status');
    }

    /**
     * Exibe informações do GPX na interface.
     * @param {Object} info
     */
    function displayGPXInfo(info) {
        dom.gpxName.textContent = info.name;
        dom.gpxDistance.textContent = formatDistance(info.totalDistance);
        dom.gpxPoints.textContent = info.totalPoints.toLocaleString('pt-BR');
        dom.gpxEleMin.textContent = formatElevation(info.minElevation);
        dom.gpxEleMax.textContent = formatElevation(info.maxElevation);
        dom.gpxGain.textContent = '+' + formatElevation(info.totalGain);
        dom.gpxLoss.textContent = '-' + formatElevation(info.totalLoss);

        dom.gpxInfo.classList.remove('hidden');

        if (!info.hasElevation) {
            dom.gpxNoElevation.classList.remove('hidden');
        } else {
            dom.gpxNoElevation.classList.add('hidden');
        }
    }

    // ============================================================
    // SEÇÕES COLAPSÁVEIS
    // ============================================================

    function setupCollapsibles() {
        $$('.card-toggle').forEach(toggle => {
            toggle.addEventListener('click', () => {
                const targetId = toggle.getAttribute('data-target');
                const body = document.getElementById(targetId);
                if (!body) return;

                if (body.classList.contains('collapsed')) {
                    body.classList.remove('collapsed');
                    body.style.maxHeight = body.scrollHeight + 'px';
                    toggle.classList.remove('collapsed');
                } else {
                    body.style.maxHeight = body.scrollHeight + 'px';
                    // Forçar reflow
                    body.offsetHeight;
                    body.classList.add('collapsed');
                    toggle.classList.add('collapsed');
                }
            });

            // Definir altura máxima inicial para as seções abertas
            const targetId = toggle.getAttribute('data-target');
            const body = document.getElementById(targetId);
            if (body && !body.classList.contains('collapsed')) {
                body.style.maxHeight = body.scrollHeight + 'px';
            }
        });
    }

    // ============================================================
    // CONTROLES DE FORMULÁRIO
    // ============================================================

    function setupControls() {
        // Sincronizar slider com input numérico
        dom.verticalSlider.addEventListener('input', () => {
            dom.vertical.value = dom.verticalSlider.value;
        });
        dom.vertical.addEventListener('input', () => {
            dom.verticalSlider.value = dom.vertical.value;
        });

        // Toggle de suavização: habilitar/desabilitar input manual
        dom.smoothRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                dom.mindist.disabled = radio.value !== '1' || !radio.checked;
            });
        });

        // Toggle de projeção personalizada
        dom.projRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                dom.projection.disabled = radio.value !== '1' || !radio.checked;
            });
        });

        // Toggle de região
        dom.regionfit.addEventListener('change', () => {
            dom.regionInputs.classList.toggle('hidden', !dom.regionfit.checked);
        });

        // Toggle de marcador personalizado
        dom.markerRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                dom.markerInterval.disabled = radio.value !== '3' || !radio.checked;
            });
        });

        // Seletores de forma
        dom.shapeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                dom.shapeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Labels de toggle switches
        $$('.toggle input').forEach(input => {
            const label = input.closest('.toggle').querySelector('.toggle-label');
            if (label) {
                const updateLabel = () => {
                    label.textContent = input.checked ? 'Ativo' : 'Desligado';
                };
                input.addEventListener('change', updateLabel);
            }
        });
    }

    // ============================================================
    // GERAÇÃO DO MODELO 3D
    // ============================================================

    function setupGenerate() {
        dom.btnGenerate.addEventListener('click', generateModel);
    }

    function generateModel() {
        if (!state.gpxData) {
            showMessage('Carregue um arquivo GPX primeiro.', 'error');
            return;
        }

        clearMessages();

        // Coletar opções do formulário
        const options = collectOptions();
        if (!options) return;

        // Mostrar progresso
        dom.progressContainer.classList.remove('hidden');
        dom.progressFill.style.width = '0%';
        dom.progressText.textContent = 'Inicializando...';
        dom.btnGenerate.disabled = true;

        // Executar geração com um pequeno delay para permitir atualização da UI
        setTimeout(() => {
            try {
                const result = ModelGenerator.generate(state.gpxData, options, (pct) => {
                    dom.progressFill.style.width = pct + '%';
                    if (pct < 30) dom.progressText.textContent = 'Analisando trilha...';
                    else if (pct < 50) dom.progressText.textContent = 'Projetando coordenadas...';
                    else if (pct < 70) dom.progressText.textContent = 'Escalando modelo...';
                    else if (pct < 90) dom.progressText.textContent = 'Gerando geometria...';
                    else dom.progressText.textContent = 'Finalizando...';
                });

                state.modelResult = result;

                // Atualizar progresso final
                dom.progressFill.style.width = '100%';
                dom.progressText.textContent = 'Concluído!';

                // Exibir resultado
                displayModel(result);

                // Atualizar campos de região se não estava ativo
                if (!options.regionfit) {
                    dom.eastMin.value = Math.round(result.bounds.minx);
                    dom.eastMax.value = Math.round(result.bounds.maxx);
                    dom.northMin.value = Math.round(result.bounds.miny);
                    dom.northMax.value = Math.round(result.bounds.maxy);
                }

                showMessage('Modelo 3D gerado com sucesso!', 'status');

            } catch (e) {
                showMessage('Erro ao gerar modelo: ' + e.message, 'error');
                console.error(e);
            } finally {
                dom.btnGenerate.disabled = false;
                setTimeout(() => {
                    dom.progressContainer.classList.add('hidden');
                }, 2000);
            }
        }, 50);
    }

    /**
     * Coleta todas as opções do formulário.
     * @returns {Object|null} Opções ou null se inválidas
     */
    function collectOptions() {
        const getRadioValue = (radios) => {
            for (const r of radios) {
                if (r.checked) return parseInt(r.value);
            }
            return 0;
        };

        const getMarkerInterval = (type) => {
            if (type === 0) return 0;
            if (type === 1) return 1000;
            if (type === 2) return 1609;
            return parseFloat(dom.markerInterval.value) || 1000;
        };

        // Obter forma selecionada
        let shapetype = 0;
        dom.shapeBtns.forEach(btn => {
            if (btn.classList.contains('active')) {
                shapetype = parseInt(btn.getAttribute('data-shape'));
            }
        });

        const markerType = getRadioValue(dom.markerRadios);

        const options = {
            buffer: parseFloat(dom.pathWidth.value) / 2.0,
            vertical: parseFloat(dom.vertical.value),
            bedx: parseFloat(dom.width.value),
            bedy: parseFloat(dom.depth.value),
            base: parseFloat(dom.base.value),
            zcut: dom.zoverride.checked ? false : dom.zcut.checked,
            zoverride: dom.zoverride.checked,
            zconstant: parseFloat(dom.zconstant.value) || 100,
            regionfit: dom.regionfit.checked,
            region_minx: parseFloat(dom.eastMin.value) || 0,
            region_maxx: parseFloat(dom.eastMax.value) || 0,
            region_miny: parseFloat(dom.northMin.value) || 0,
            region_maxy: parseFloat(dom.northMax.value) || 0,
            shapetype: shapetype,
            projtype: getRadioValue(dom.projRadios),
            projection: dom.projection.value,
            markerInterval: getMarkerInterval(markerType),
            smoothtype: getRadioValue(dom.smoothRadios),
            smoothspan: parseFloat(dom.mindist.value) || 10
        };

        // Validação
        if (!isFinite(options.vertical) || options.vertical < 1) {
            showMessage('O exagero vertical deve ser maior ou igual a 1.', 'error');
            return null;
        }
        if (!isFinite(options.bedx) || options.bedx < 20) {
            showMessage('A largura deve ser maior ou igual a 20mm.', 'error');
            return null;
        }
        if (!isFinite(options.bedy) || options.bedy < 20) {
            showMessage('A profundidade deve ser maior ou igual a 20mm.', 'error');
            return null;
        }
        if (!isFinite(options.buffer) || options.buffer < 0.5) {
            showMessage('A largura do caminho deve ser maior ou igual a 1mm.', 'error');
            return null;
        }
        if (options.projtype === 1 && !options.projection.trim()) {
            showMessage('Defina uma projeção personalizada (formato proj4).', 'error');
            return null;
        }

        return options;
    }

    /**
     * Exibe o modelo gerado na interface.
     * @param {Object} result
     */
    function displayModel(result) {
        // Preview 3D
        if (!state.preview) {
            state.preview = new Preview3D(dom.previewContainer);
        }

        if (result.code && result.code.rawPoints && result.code.rawFaces) {
            state.preview.loadModel(result.code.rawPoints, result.code.rawFaces);
            dom.previewControls.classList.remove('hidden');
        }

        // Downloads
        dom.outputDownloads.classList.remove('hidden');

        // Código paramétrico
        dom.codeJscad.textContent = result.code.jscad(false);
        dom.codeOscad.textContent = result.code.oscad();
        dom.outputCode.classList.remove('hidden');

        // Scroll para o preview
        dom.previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ============================================================
    // CONTROLES DO PREVIEW 3D
    // ============================================================

    function setupPreviewControls() {
        dom.viewBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (state.preview) {
                    state.preview.setView(btn.getAttribute('data-view'));
                }
            });
        });
    }

    // ============================================================
    // DOWNLOAD STL
    // ============================================================

    dom.btnDownloadStl.addEventListener('click', () => {
        if (!state.modelResult || !state.modelResult.code) {
            showMessage('Gere o modelo primeiro.', 'error');
            return;
        }

        try {
            const stlData = state.modelResult.code.generateSTL();
            const blob = new Blob([stlData], { type: 'application/sla' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;

            // Usar nome do GPX se disponível
            const baseName = state.gpxInfo ? state.gpxInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_') : 'modelo';
            link.download = baseName + '.stl';

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showMessage('Arquivo STL baixado com sucesso!', 'status');
        } catch (e) {
            showMessage('Erro ao gerar STL: ' + e.message, 'error');
        }
    });

    // ============================================================
    // ABAS DE CÓDIGO
    // ============================================================

    function setupCodeTabs() {
        dom.codeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                dom.codeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const target = tab.getAttribute('data-tab');
                dom.codeJscad.classList.toggle('hidden', target !== 'jscad');
                dom.codeOscad.classList.toggle('hidden', target !== 'oscad');
            });
        });
    }

    function setupCopyButton() {
        dom.btnCopyCode.addEventListener('click', () => {
            // Determinar qual aba está ativa
            const activeTab = document.querySelector('.code-tab.active');
            const target = activeTab ? activeTab.getAttribute('data-tab') : 'jscad';

            const codeBlock = target === 'oscad' ? dom.codeOscad : dom.codeJscad;
            const text = codeBlock.textContent;

            navigator.clipboard.writeText(text).then(() => {
                dom.btnCopyCode.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copiado!
                `;
                setTimeout(() => {
                    dom.btnCopyCode.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copiar
                    `;
                }, 2000);
            }).catch(() => {
                showMessage('Não foi possível copiar. Selecione o código manualmente.', 'error');
            });
        });
    }

    // ============================================================
    // MENSAGENS
    // ============================================================

    function showMessage(text, type) {
        const msg = document.createElement('div');
        msg.className = `msg ${type === 'error' ? 'errormsg' : 'statusmsg'}`;
        msg.textContent = text;
        msg.addEventListener('click', () => msg.remove());

        dom.messages.appendChild(msg);

        // Auto-remover mensagens de status após 5s
        if (type === 'status') {
            setTimeout(() => {
                if (msg.parentNode) msg.remove();
            }, 5000);
        }
    }

    function clearMessages() {
        dom.messages.innerHTML = '';
    }

    // ============================================================
    // INICIAR QUANDO O DOM ESTIVER PRONTO
    // ============================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
