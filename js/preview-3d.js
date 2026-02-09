/**
 * preview-3d.js - Preview 3D WebGL para modelos gerados
 *
 * Renderiza modelos 3D no navegador usando WebGL puro (sem dependência de Three.js).
 * Suporta rotação, pan e zoom via mouse e toque.
 * Fallback visual quando WebGL não está disponível.
 */

class Preview3D {
    /**
     * @param {HTMLElement} container - Elemento DOM que conterá o canvas
     */
    constructor(container) {
        this.container = container;
        this.canvas = null;
        this.gl = null;
        this.program = null;

        // Estado da câmera
        this.rotation = { x: -30, y: 45 };
        this.pan = { x: 0, y: 0 };
        this.zoom = 1.5;
        this.autoRotate = false;

        // Estado de interação
        this.isDragging = false;
        this.isPanning = false;
        this.lastMouse = { x: 0, y: 0 };
        this.touchStartDist = 0;

        // Dados do modelo
        this.vertices = null;
        this.normals = null;
        this.vertexCount = 0;
        this.modelCenter = [0, 0, 0];
        this.modelSize = 1;

        // Buffers WebGL
        this.vertexBuffer = null;
        this.normalBuffer = null;

        this._init();
    }

    /**
     * Inicializa o canvas WebGL e os event listeners.
     * @private
     */
    _init() {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'preview-canvas';
        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);

        this._resize();

        // Tentar inicializar WebGL
        try {
            this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        } catch (e) {
            // WebGL não disponível
        }

        if (!this.gl) {
            this._showFallback();
            return;
        }

        this._initShaders();
        this._setupEvents();

        // Observe resize
        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            this._render();
        });
        this._resizeObserver.observe(this.container);
    }

    /**
     * Mostra mensagem de fallback quando WebGL não está disponível.
     * @private
     */
    _showFallback() {
        this.container.innerHTML = `
            <div class="preview-fallback">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
                <p>Seu navegador não suporta WebGL.</p>
                <p>O modelo STL ainda pode ser gerado e baixado.</p>
            </div>
        `;
    }

    /**
     * Redimensiona o canvas para preencher o container.
     * @private
     */
    _resize() {
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';

        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * Inicializa shaders WebGL.
     * @private
     */
    _initShaders() {
        const gl = this.gl;

        const vsSource = `
            attribute vec3 aPosition;
            attribute vec3 aNormal;
            uniform mat4 uProjection;
            uniform mat4 uModelView;
            uniform mat3 uNormalMatrix;
            varying vec3 vNormal;
            varying vec3 vPosition;
            void main() {
                vec4 pos = uModelView * vec4(aPosition, 1.0);
                vPosition = pos.xyz;
                vNormal = normalize(uNormalMatrix * aNormal);
                gl_Position = uProjection * pos;
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec3 vNormal;
            varying vec3 vPosition;
            uniform vec3 uColor;
            uniform vec3 uLightDir;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 lightDir = normalize(uLightDir);
                float diff = max(dot(normal, lightDir), 0.0);
                float ambient = 0.3;
                vec3 viewDir = normalize(-vPosition);
                vec3 reflectDir = reflect(-lightDir, normal);
                float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0) * 0.3;
                vec3 color = uColor * (ambient + diff * 0.7) + vec3(spec);
                gl_FragColor = vec4(color, 1.0);
            }
        `;

        const vs = this._compileShader(gl.VERTEX_SHADER, vsSource);
        const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Erro ao linkar programa de shaders');
            return;
        }

        gl.useProgram(this.program);

        // Localizações de atributos e uniformes
        this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
        this.aNormal = gl.getAttribLocation(this.program, 'aNormal');
        this.uProjection = gl.getUniformLocation(this.program, 'uProjection');
        this.uModelView = gl.getUniformLocation(this.program, 'uModelView');
        this.uNormalMatrix = gl.getUniformLocation(this.program, 'uNormalMatrix');
        this.uColor = gl.getUniformLocation(this.program, 'uColor');
        this.uLightDir = gl.getUniformLocation(this.program, 'uLightDir');

        // Configurar estado do GL
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.clearColor(0.12, 0.14, 0.18, 1.0);
    }

    /**
     * Compila um shader WebGL.
     * @private
     */
    _compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Erro de shader:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    /**
     * Configura event listeners para interação com mouse e toque.
     * @private
     */
    _setupEvents() {
        const canvas = this.canvas;

        // Mouse
        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (e.button === 0) this.isDragging = true;
            if (e.button === 1 || e.button === 2) this.isPanning = true;
            this.lastMouse = { x: e.clientX, y: e.clientY };
        });

        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging && !this.isPanning) return;
            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;
            this.lastMouse = { x: e.clientX, y: e.clientY };

            if (this.isDragging) {
                this.rotation.y += dx * 0.5;
                this.rotation.x += dy * 0.5;
                this.rotation.x = Math.max(-90, Math.min(90, this.rotation.x));
            }
            if (this.isPanning) {
                this.pan.x += dx * 0.005 * this.zoom;
                this.pan.y -= dy * 0.005 * this.zoom;
            }
            this._render();
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.isPanning = false;
        });

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom *= e.deltaY > 0 ? 1.1 : 0.9;
            this.zoom = Math.max(0.1, Math.min(20, this.zoom));
            this._render();
        }, { passive: false });

        // Touch
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                this.isDragging = true;
                this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else if (e.touches.length === 2) {
                this.isDragging = false;
                this.touchStartDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && this.isDragging) {
                const dx = e.touches[0].clientX - this.lastMouse.x;
                const dy = e.touches[0].clientY - this.lastMouse.y;
                this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                this.rotation.y += dx * 0.5;
                this.rotation.x += dy * 0.5;
                this.rotation.x = Math.max(-90, Math.min(90, this.rotation.x));
                this._render();
            } else if (e.touches.length === 2) {
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const scale = this.touchStartDist / dist;
                this.zoom *= scale;
                this.zoom = Math.max(0.1, Math.min(20, this.zoom));
                this.touchStartDist = dist;
                this._render();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', () => {
            this.isDragging = false;
        });
    }

    /**
     * Carrega um modelo (vértices e faces) para renderização.
     *
     * @param {number[][]} points - Vértices [x, y, z]
     * @param {number[][]} faces - Triângulos [i0, i1, i2]
     */
    loadModel(points, faces) {
        if (!this.gl) return;
        const gl = this.gl;

        // Converter faces em vértices e normais expandidos
        const verts = [];
        const norms = [];

        for (const face of faces) {
            const v0 = points[face[0]];
            const v1 = points[face[1]];
            const v2 = points[face[2]];

            // Normal do triângulo
            const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
            const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) { nx /= len; ny /= len; nz /= len; }

            verts.push(...v0, ...v1, ...v2);
            norms.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        }

        this.vertexCount = faces.length * 3;

        // Calcular centro e tamanho do modelo
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const p of points) {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
            if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
        }
        this.modelCenter = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
        this.modelSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

        // Criar buffers
        if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
        if (this.normalBuffer) gl.deleteBuffer(this.normalBuffer);

        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

        this.normalBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(norms), gl.STATIC_DRAW);

        // Reset da câmera
        this.rotation = { x: -30, y: 45 };
        this.pan = { x: 0, y: 0 };
        this.zoom = 1.5;

        this._render();
    }

    /**
     * Renderiza a cena atual.
     * @private
     */
    _render() {
        const gl = this.gl;
        if (!gl || !this.vertexBuffer) return;

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const aspect = this.canvas.width / this.canvas.height;
        const projection = this._perspective(45, aspect, 0.1, 1000);

        // ModelView: translação + rotação para centralizar o modelo
        const dist = this.modelSize * this.zoom;
        let mv = this._identity();
        mv = this._translate(mv, [this.pan.x, this.pan.y, -dist]);
        mv = this._rotateX(mv, this.rotation.x * Math.PI / 180);
        mv = this._rotateY(mv, this.rotation.y * Math.PI / 180);
        mv = this._translate(mv, [
            -this.modelCenter[0],
            -this.modelCenter[1],
            -this.modelCenter[2]
        ]);

        // Matriz normal (inversa transposta da modelview 3x3)
        const nm = this._normalMatrix(mv);

        gl.useProgram(this.program);

        // Uniformes
        gl.uniformMatrix4fv(this.uProjection, false, projection);
        gl.uniformMatrix4fv(this.uModelView, false, mv);
        gl.uniformMatrix3fv(this.uNormalMatrix, false, nm);
        gl.uniform3fv(this.uColor, [0.18, 0.62, 0.42]); // verde terreno
        gl.uniform3fv(this.uLightDir, [0.5, 0.7, 1.0]);

        // Atributos
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.enableVertexAttribArray(this.aNormal);
        gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }

    /**
     * Define a perspectiva da câmera para uma vista predefinida.
     * @param {string} view - 'front', 'rear', 'left', 'right', 'top', 'reset'
     */
    setView(view) {
        this.pan = { x: 0, y: 0 };
        this.zoom = 1.5;

        switch (view) {
            case 'front':  this.rotation = { x: 0, y: 0 }; break;
            case 'rear':   this.rotation = { x: 0, y: 180 }; break;
            case 'left':   this.rotation = { x: 0, y: -90 }; break;
            case 'right':  this.rotation = { x: 0, y: 90 }; break;
            case 'top':    this.rotation = { x: -90, y: 0 }; break;
            case 'reset':  this.rotation = { x: -30, y: 45 }; break;
        }

        this._render();
    }

    // ============================================================
    // Funções de matriz (implementação mínima para evitar dependências)
    // ============================================================

    _identity() {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }

    _perspective(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov * Math.PI / 360);
        const nf = 1 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0
        ]);
    }

    _translate(m, v) {
        const r = new Float32Array(m);
        r[12] += m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
        r[13] += m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
        r[14] += m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
        r[15] += m[3] * v[0] + m[7] * v[1] + m[11] * v[2];
        return r;
    }

    _rotateX(m, angle) {
        const s = Math.sin(angle), c = Math.cos(angle);
        const r = new Float32Array(m);
        const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
        const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
        r[4] = m4 * c + m8 * s;
        r[5] = m5 * c + m9 * s;
        r[6] = m6 * c + m10 * s;
        r[7] = m7 * c + m11 * s;
        r[8] = m8 * c - m4 * s;
        r[9] = m9 * c - m5 * s;
        r[10] = m10 * c - m6 * s;
        r[11] = m11 * c - m7 * s;
        return r;
    }

    _rotateY(m, angle) {
        const s = Math.sin(angle), c = Math.cos(angle);
        const r = new Float32Array(m);
        const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
        const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
        r[0] = m0 * c - m8 * s;
        r[1] = m1 * c - m9 * s;
        r[2] = m2 * c - m10 * s;
        r[3] = m3 * c - m11 * s;
        r[8] = m0 * s + m8 * c;
        r[9] = m1 * s + m9 * c;
        r[10] = m2 * s + m10 * c;
        r[11] = m3 * s + m11 * c;
        return r;
    }

    _normalMatrix(m) {
        // Extrair 3x3 e calcular inversa transposta
        const a = m[0], b = m[1], c = m[2];
        const d = m[4], e = m[5], f = m[6];
        const g = m[8], h = m[9], i = m[10];

        const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        if (Math.abs(det) < 1e-10) return new Float32Array(9);

        const id = 1 / det;
        return new Float32Array([
            (e * i - f * h) * id, (c * h - b * i) * id, (b * f - c * e) * id,
            (f * g - d * i) * id, (a * i - c * g) * id, (c * d - a * f) * id,
            (d * h - e * g) * id, (b * g - a * h) * id, (a * e - b * d) * id
        ]);
    }

    /**
     * Libera recursos WebGL.
     */
    dispose() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
        }
        if (this.gl) {
            if (this.vertexBuffer) this.gl.deleteBuffer(this.vertexBuffer);
            if (this.normalBuffer) this.gl.deleteBuffer(this.normalBuffer);
            if (this.program) this.gl.deleteProgram(this.program);
        }
    }
}
