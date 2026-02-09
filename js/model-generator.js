/**
 * model-generator.js - Gerador de modelos 3D a partir de dados GPX
 *
 * Converte trilhas GPS em geometria 3D (poliedros) que podem ser
 * exportados como STL para impressão 3D.
 *
 * Baseado na lógica original do GPXtruder por Jim DeVona (MIT License).
 * Refatorado em módulo ES6+ com melhorias de legibilidade.
 */

const ModelGenerator = {

    // Tipos de forma do modelo
    SHAPE_MAP: 0,
    SHAPE_LINEAR: 1,
    SHAPE_RING: 2,

    // Tipos de projeção
    PROJ_GOOGLE: 0,
    PROJ_CUSTOM: 1,
    PROJ_UTM: 2,

    /**
     * Gera o modelo 3D a partir dos pontos GPX e opções.
     *
     * @param {number[][]} pts - Array de [lon, lat, ele]
     * @param {Object} options - Opções de geração
     * @param {function} [onProgress] - Callback de progresso (0-100)
     * @returns {Object} { code, bounds, distance, outputPoints, scale }
     */
    generate(pts, options, onProgress) {
        const ctx = {
            options,
            bed: {
                x: options.bedx - (2 * options.buffer),
                y: options.bedy - (2 * options.buffer)
            },
            ll: [],
            d: [],
            distance: 0,
            ringRadius: 0,
            smoothTotal: 0,
            projectedPoints: [],
            outputPoints: [],
            markers: [],
            bounds: null,
            offset: null,
            scale: null
        };

        if (onProgress) onProgress(10);

        // Fase 1: Escanear pontos (distâncias, suavização, marcadores)
        this._scanPoints(ctx, pts);
        if (onProgress) onProgress(30);

        // Fase 2: Projetar pontos para coordenadas planas
        this._projectPoints(ctx);
        if (onProgress) onProgress(50);

        // Fase 3: Escalar e centralizar
        const zscale = this._calculateZScale(ctx);
        const fit = (v) => [
            ctx.scale * (v[0] - ctx.offset[0]),
            ctx.scale * (v[1] - ctx.offset[1]),
            zscale * (v[2] - ctx.offset[2]) * ctx.options.vertical + ctx.options.base
        ];

        ctx.outputPoints = ctx.projectedPoints.map(fit);
        ctx.markers = ctx.markers.map(m => ({
            location: fit(m.location),
            orientation: m.orientation
        }));
        if (onProgress) onProgress(70);

        // Fase 4: Gerar geometria do caminho
        const code = this._processPath(ctx);
        if (onProgress) onProgress(90);

        return {
            code,
            bounds: ctx.bounds,
            distance: ctx.distance,
            outputPoints: ctx.outputPoints,
            scale: ctx.scale,
            bed: { x: ctx.options.bedx, y: ctx.options.bedy }
        };
    },

    /**
     * Calcula o fator de escala Z, considerando projeções customizadas.
     * @private
     */
    _calculateZScale(ctx) {
        if (ctx.options.projtype === this.PROJ_CUSTOM) {
            return ctx.bed.y / distVincenty(
                ctx.bounds.miny, ctx.bounds.minx,
                ctx.bounds.maxy, ctx.bounds.minx
            );
        }
        return ctx.scale;
    },

    /**
     * Escaneia os pontos para calcular distâncias, bounds geográficos,
     * posições de marcadores e aplicar suavização.
     * @private
     */
    _scanPoints(ctx, pts) {
        let lastpt = pts[0];
        let minLon = lastpt[0], maxLon = lastpt[0];
        let minLat = lastpt[1], maxLat = lastpt[1];
        const rawpoints = [lastpt];
        const rawpointcd = [];
        let totaldist = 0;

        let cd = 0, md = 0, lastmd = 0;
        const markerObjs = [];

        // Percorrer todos os pontos para calcular distâncias e marcadores
        for (let i = 1; i < pts.length; i++) {
            const rawpt = pts[i];

            if (rawpt[0] < minLon) minLon = rawpt[0];
            if (rawpt[0] > maxLon) maxLon = rawpt[0];
            if (rawpt[1] < minLat) minLat = rawpt[1];
            if (rawpt[1] > maxLat) maxLat = rawpt[1];

            rawpoints.push(rawpt);

            const segdist = distVincenty(lastpt[1], lastpt[0], rawpt[1], rawpt[0]);
            totaldist += segdist;
            lastpt = rawpt;

            lastmd = md;
            md += segdist;
            cd += segdist;
            rawpointcd.push(cd);

            // Verificar se é hora de colocar um marcador
            if (ctx.options.markerInterval > 0 && md >= ctx.options.markerInterval) {
                const lastSeg = ctx.options.markerInterval - lastmd;
                const nextSeg = segdist - lastSeg;
                const pd = lastSeg / segdist;

                const markerpoint = [
                    pts[i - 1][0] + pd * (rawpt[0] - pts[i - 1][0]),
                    pts[i - 1][1] + pd * (rawpt[1] - pts[i - 1][1]),
                    pts[i - 1][2] + pd * (rawpt[2] - pts[i - 1][2])
                ];

                markerObjs.push({
                    loc: markerpoint,
                    pos: cd - nextSeg,
                    seg: i
                });

                md = nextSeg;
            }
        }

        ctx.distance = totaldist;
        ctx.ringRadius = totaldist / (Math.PI * 2);

        // Configurar projeção
        if (ctx.options.projtype === this.PROJ_UTM) {
            const lat = (minLat + maxLat) / 2;
            const lon = (minLon + maxLon) / 2;
            ctx.options.projection = UTM.proj(lat, lon);
        } else if (ctx.options.projtype === this.PROJ_GOOGLE) {
            ctx.options.projection = "GOOGLE";
        }

        // Inicializar projetor de pontos
        try {
            PointProjector.init(ctx.options.projection);
        } catch (e) {
            throw new Error("Projeção de mapa não reconhecida.");
        }

        // Projetar localizações dos marcadores
        for (let i = 0; i < markerObjs.length; i++) {
            const markerAngle = vectorAngle(
                this._projectPoint(ctx, rawpoints[markerObjs[i].seg - 1],
                    (rawpointcd[markerObjs[i].seg - 1]) / ctx.distance),
                this._projectPoint(ctx, rawpoints[markerObjs[i].seg],
                    (rawpointcd[markerObjs[i].seg]) / ctx.distance)
            );

            ctx.markers.push({
                location: this._projectPoint(ctx, markerObjs[i].loc, markerObjs[i].pos / ctx.distance),
                orientation: markerAngle
            });
        }

        // Calcular distância de suavização
        let smoothingDistance = ctx.options.smoothspan;

        if (ctx.options.smoothtype === 0) {
            // Suavização automática
            let scale = null;
            if (ctx.options.shapetype === this.SHAPE_MAP) {
                const minGeo = proj4('GOOGLE', [minLon, minLat]);
                const maxGeo = proj4('GOOGLE', [maxLon, maxLat]);
                scale = calcScale(ctx.bed, maxGeo[0] - minGeo[0], maxGeo[1] - minGeo[1]);
            } else if (ctx.options.shapetype === this.SHAPE_LINEAR) {
                scale = calcScale(ctx.bed, ctx.distance, 0);
            } else if (ctx.options.shapetype === this.SHAPE_RING) {
                scale = calcScale(ctx.bed, 2 * ctx.ringRadius, 2 * ctx.ringRadius);
            }
            smoothingDistance = Math.floor(ctx.options.buffer / scale);
        }

        // Aplicar filtro de suavização por distância mínima
        this._distFilter(ctx, rawpoints, smoothingDistance);
    },

    /**
     * Filtra pontos por distância mínima (suavização).
     * @private
     */
    _distFilter(ctx, points, mindist) {
        const filteredPts = [points[0]];
        const filteredDst = [];
        let total = 0;

        for (let cur = 1, pre = 0; cur < points.length; cur++) {
            const dist = distVincenty(
                points[cur][1], points[cur][0],
                filteredPts[pre][1], filteredPts[pre][0]
            );

            if (mindist === 0 || dist >= mindist) {
                filteredPts.push(points[cur]);
                filteredDst.push(dist);
                total += dist;
                pre += 1;
            }
        }

        ctx.ll = filteredPts;
        ctx.d = filteredDst;
        ctx.smoothTotal = total;
    },

    /**
     * Projeta um único ponto de acordo com o tipo de forma selecionado.
     * @private
     */
    _projectPoint(ctx, point, cdr) {
        if (ctx.options.shapetype === this.SHAPE_LINEAR) {
            return PointProjector.linear(point, cdr, ctx.distance);
        } else if (ctx.options.shapetype === this.SHAPE_RING) {
            return PointProjector.ring(point, cdr, ctx.ringRadius);
        }
        return PointProjector.project(point);
    },

    /**
     * Projeta todos os pontos filtrados e calcula bounds.
     * @private
     */
    _projectPoints(ctx) {
        let cd = 0;
        const xyz = this._projectPoint(ctx, ctx.ll[0], 0);
        ctx.bounds = new Bounds(xyz);
        ctx.projectedPoints.push(xyz);

        for (let i = 1; i < ctx.ll.length; i++) {
            cd += ctx.d[i - 1];
            const point = this._projectPoint(ctx, ctx.ll[i], cd / ctx.smoothTotal);
            ctx.bounds.update(point);
            ctx.projectedPoints.push(point);
        }

        // Aplicar região personalizada se solicitado
        if (ctx.options.regionfit) {
            ctx.bounds.maxx = ctx.options.region_maxx;
            ctx.bounds.minx = ctx.options.region_minx;
            ctx.bounds.maxy = ctx.options.region_maxy;
            ctx.bounds.miny = ctx.options.region_miny;
        }

        ctx.offset = calcOffsets(ctx.bounds, ctx.options.zcut);
        ctx.scale = scaleBounds(ctx.bounds, ctx.bed);
    },

    /**
     * Gera a geometria do caminho (vértices e faces do poliedro).
     * @private
     */
    _processPath(ctx) {
        const isAcute = (angle) =>
            (Math.abs(angle) > Math.PI / 2) && (Math.abs(angle) < (3 * Math.PI) / 2);

        const segmentAngle = (i) => {
            if (i + 1 === ctx.outputPoints.length) return segmentAngle(i - 1);
            return vectorAngle(ctx.outputPoints[i], ctx.outputPoints[i + 1]);
        };

        const jointPoints = (i, rel, avga) => {
            let jointr = ctx.options.buffer / Math.cos(rel / 2);

            // Limitar para evitar artefatos em ângulos agudos
            if (Math.abs(jointr) > ctx.options.buffer * 2) {
                jointr = Math.sign(jointr) * ctx.options.buffer * 2;
            }

            const lx = ctx.outputPoints[i][0] + jointr * Math.cos(avga + Math.PI / 2);
            const ly = ctx.outputPoints[i][1] + jointr * Math.sin(avga + Math.PI / 2);
            const rx = ctx.outputPoints[i][0] + jointr * Math.cos(avga - Math.PI / 2);
            const ry = ctx.outputPoints[i][1] + jointr * Math.sin(avga - Math.PI / 2);

            return [[lx, ly], [rx, ry]];
        };

        let lastAngle, angle, relAngle, jointAngle, pathPts;
        const vertices = [];
        const faces = [];

        for (let i = 0, s = 0; i < ctx.outputPoints.length; i++) {
            angle = segmentAngle(i);
            if (i === 0) lastAngle = angle;

            relAngle = angle - lastAngle;
            jointAngle = relAngle / 2 + lastAngle;

            // Colapsar séries de segmentos com ângulos agudos
            if (isAcute(relAngle) &&
                (i < ctx.outputPoints.length - 1) &&
                isAcute(segmentAngle(i + 1) - angle)) {
                continue;
            }

            pathPts = jointPoints(i, relAngle, jointAngle);
            PathSegment.points(vertices, pathPts, ctx.outputPoints[i][2]);
            PathSegment.faces(faces, s);
            s++;
            lastAngle = angle;
        }

        // Tampa final
        PathSegment.lastFace(faces, vertices.length / 4);

        return new ModelCode(vertices, faces, ctx.markers, {
            markerWidth: 2 * ctx.options.buffer + 2
        });
    }
};


// ============================================================
// PathSegment - Geração de faces e vértices de segmentos
// ============================================================

const PathSegment = {
    /**
     * Adiciona 4 vértices de um quadrilátero perpendicular ao caminho.
     */
    points(a, v, z) {
        a.push([v[0][0], v[0][1], 0]);    // inferior esquerdo
        a.push([v[1][0], v[1][1], 0]);    // inferior direito
        a.push([v[0][0], v[0][1], z]);    // superior esquerdo
        a.push([v[1][0], v[1][1], z]);    // superior direito
    },

    /**
     * Face da tampa inicial.
     */
    firstFace(a) {
        a.push([0, 2, 3]);
        a.push([3, 1, 0]);
    },

    /**
     * Face da tampa final.
     */
    lastFace(a, s) {
        const i = (s - 1) * 4;
        a.push([i + 2, i + 1, i + 3]);
        a.push([i + 2, i + 0, i + 1]);
    },

    /**
     * Faces de um segmento do caminho (topo, laterais, fundo).
     */
    faces(a, s) {
        if (s === 0) {
            this.firstFace(a);
            return;
        }
        const i = (s - 1) * 4;

        // Topo
        a.push([i + 2, i + 6, i + 3]);
        a.push([i + 3, i + 6, i + 7]);

        // Esquerda
        a.push([i + 3, i + 7, i + 5]);
        a.push([i + 3, i + 5, i + 1]);

        // Direita
        a.push([i + 6, i + 2, i + 0]);
        a.push([i + 6, i + 0, i + 4]);

        // Fundo
        a.push([i + 0, i + 5, i + 4]);
        a.push([i + 0, i + 1, i + 5]);
    }
};


// ============================================================
// ModelCode - Geração de código paramétrico (JSCAD/OpenSCAD/STL)
// ============================================================

class ModelCode {
    /**
     * @param {number[][]} points - Vértices [x, y, z]
     * @param {number[][]} faces - Faces (índices de vértices)
     * @param {Object[]} markers - Marcadores de distância
     * @param {Object} options - { markerWidth }
     */
    constructor(points, faces, markers, options) {
        this.rawPoints = points;
        this.rawFaces = faces;
        this.rawMarkers = markers;

        // Strings formatadas para SCAD
        this.pointsStr = points.map(v =>
            `[${v[0].toFixed(4)}, ${v[1].toFixed(4)}, ${v[2].toFixed(4)}]`
        ).join(",\n");

        this.facesStr = faces.map(v =>
            `[${v[0]}, ${v[1]}, ${v[2]}]`
        ).join(",\n");

        this.markersStr = markers.map(m =>
            `marker([${m.location[0]}, ${m.location[1]}], ${(m.orientation * 180 / Math.PI)}, ${m.location[2]})`
        );

        this.options = options;
    }

    /**
     * Gera código OpenJSCAD.
     * @param {boolean} preview - Se true, usa sintaxe CSG (para preview interno)
     * @returns {string} Código JSCAD
     */
    jscad(preview) {
        const models = ["{name: 'profile', caption: 'Profile', data: profile()}"];

        let result = "function profile() {\nreturn ";
        if (preview) {
            result += `CSG.polyhedron({points:[\n${this.pointsStr}\n],\nfaces:[\n${this.facesStr}\n]})`;
        } else {
            result += `polyhedron({points:[\n${this.pointsStr}\n],\ntriangles:[\n${this.facesStr}\n]})`;
        }
        result += ";\n}\n\n";

        if (this.markersStr.length > 0) {
            const m = this.markersStr[0] + this.markersStr.slice(1).map(s =>
                `.union(${s})`
            ).join("");

            if (preview) {
                result += `function marker(position, orientation, height) {\nvar z = height + 2;\n` +
                    `return CSG.cube({radius: [1, ${this.options.markerWidth}, z/2], center: [0, 0, 0]})` +
                    `.rotateZ(orientation).translate([position[0], position[1], z/2]);\n}\n`;
            } else {
                result += `function marker(position, orientation, height) {\nvar z = height + 2;\n` +
                    `return cube({size: [1, ${this.options.markerWidth}, z], center: true})` +
                    `.rotateZ(orientation).translate([position[0], position[1], z/2]);\n}\n`;
            }

            result += `function markers() {\nreturn ${m};\n}\n\n`;
            models.push("{name: 'markers', caption: 'Markers', data: markers()}");
        }

        if (preview) {
            result += `function main() {\nreturn [${models.join(',')}];\n}\n`;
        } else {
            result += `function main() {\nreturn profile()${this.markersStr.length > 0 ? '.union(markers())' : ''};\n}\n`;
        }

        return result;
    }

    /**
     * Gera código OpenSCAD.
     * @returns {string} Código OpenSCAD
     */
    oscad() {
        let result = `module profile() {\npolyhedron(points=[\n${this.pointsStr}\n],\nfaces=[\n${this.facesStr}\n]);\n}\n\n`;

        if (this.markersStr.length > 0) {
            result += `module marker(position, orientation, height) {\n` +
                `\tassign(z=height+2) {\n` +
                `\ttranslate([position[0], position[1], z/2])\n` +
                `\trotate([0, 0, orientation])\n` +
                `\tcube(size=[1, ${this.options.markerWidth}, z], center=true);\n}}\n\n`;
            result += `module markers() {\n\tunion() {\n\t\t${this.markersStr.join(";\n\t\t")};\n\t}\n}\n\n`;
            result += "markers();\n";
        }

        result += "profile();\n";
        return result;
    }

    /**
     * Gera dados STL binário diretamente a partir da geometria.
     * @returns {ArrayBuffer} Arquivo STL binário
     */
    generateSTL() {
        const numTriangles = this.rawFaces.length;
        const bufferSize = 84 + (numTriangles * 50);
        const buffer = new ArrayBuffer(bufferSize);
        const view = new DataView(buffer);

        // Header (80 bytes, pode conter texto)
        const header = "STL gerado por GPXtruder Modern";
        for (let i = 0; i < 80; i++) {
            view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
        }

        // Número de triângulos
        view.setUint32(80, numTriangles, true);

        let offset = 84;
        for (let i = 0; i < numTriangles; i++) {
            const face = this.rawFaces[i];
            const v0 = this.rawPoints[face[0]];
            const v1 = this.rawPoints[face[1]];
            const v2 = this.rawPoints[face[2]];

            // Calcular normal do triângulo
            const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
            const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) { nx /= len; ny /= len; nz /= len; }

            // Normal
            view.setFloat32(offset, nx, true); offset += 4;
            view.setFloat32(offset, ny, true); offset += 4;
            view.setFloat32(offset, nz, true); offset += 4;

            // Vértice 1
            view.setFloat32(offset, v0[0], true); offset += 4;
            view.setFloat32(offset, v0[1], true); offset += 4;
            view.setFloat32(offset, v0[2], true); offset += 4;

            // Vértice 2
            view.setFloat32(offset, v1[0], true); offset += 4;
            view.setFloat32(offset, v1[1], true); offset += 4;
            view.setFloat32(offset, v1[2], true); offset += 4;

            // Vértice 3
            view.setFloat32(offset, v2[0], true); offset += 4;
            view.setFloat32(offset, v2[1], true); offset += 4;
            view.setFloat32(offset, v2[2], true); offset += 4;

            // Attribute byte count
            view.setUint16(offset, 0, true); offset += 2;
        }

        return buffer;
    }
}
