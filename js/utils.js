/**
 * utils.js - Funções utilitárias para GPXtruder Modern
 *
 * Inclui:
 * - Cálculo de distância geodésica (Vincenty)
 * - Projeções de coordenadas (wrapper para proj4)
 * - Helpers de geometria e conversão
 * - Classe Bounds para gerenciamento de limites
 * - Classe UTM para projeção UTM automática
 */

// ============================================================
// VINCENTY - Cálculo de distância geodésica no elipsoide WGS84
// ============================================================

/**
 * Calcula distância em metros entre dois pontos geográficos
 * usando a fórmula inversa de Vincenty (precisão ~0.5mm).
 * Baseado na implementação original do GPXtruder.
 *
 * @param {number} lat1 - Latitude do ponto 1 (graus decimais)
 * @param {number} lon1 - Longitude do ponto 1 (graus decimais)
 * @param {number} lat2 - Latitude do ponto 2 (graus decimais)
 * @param {number} lon2 - Longitude do ponto 2 (graus decimais)
 * @returns {number} Distância em metros (NaN se não convergir)
 */
function distVincenty(lat1, lon1, lat2, lon2) {
    // Parâmetros do elipsoide WGS84
    const a = 6378137;           // semi-eixo maior (metros)
    const b = 6356752.314245;    // semi-eixo menor
    const f = 1 / 298.257223563; // achatamento

    const toRad = (deg) => deg * Math.PI / 180;

    const L = toRad(lon2 - lon1);
    const U1 = Math.atan((1 - f) * Math.tan(toRad(lat1)));
    const U2 = Math.atan((1 - f) * Math.tan(toRad(lat2)));

    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

    let lambda = L, lambdaP, iterLimit = 100;
    let sinLambda, cosLambda, sinSigma, cosSigma, sigma;
    let sinAlpha, cosSqAlpha, cos2SigmaM, C;

    do {
        sinLambda = Math.sin(lambda);
        cosLambda = Math.cos(lambda);

        sinSigma = Math.sqrt(
            (cosU2 * sinLambda) * (cosU2 * sinLambda) +
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) *
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
        );

        if (sinSigma === 0) return 0; // pontos coincidentes

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);
        sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;

        if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // linha equatorial

        C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
        lambdaP = lambda;
        lambda = L + (1 - C) * f * sinAlpha *
            (sigma + C * sinSigma *
                (cos2SigmaM + C * cosSigma *
                    (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

    if (iterLimit === 0) return NaN; // não convergiu

    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

    return b * A * (sigma - deltaSigma);
}


// ============================================================
// PROJEÇÃO DE PONTOS
// ============================================================

/**
 * Gerenciador de projeção de coordenadas.
 * Converte coordenadas geográficas (lon/lat) para coordenadas planas (x/y).
 * Suporta 3 modos: mapa (projeção cartográfica), linear e anel.
 */
const PointProjector = {
    projection: null,

    /**
     * Inicializa o projetor com uma definição de projeção proj4.
     * @param {string} projDefinition - String de definição proj4 ou "GOOGLE"
     */
    init(projDefinition) {
        this.projection = proj4(projDefinition);
    },

    /**
     * Modo Linear: distribui pontos ao longo de uma linha reta.
     * @param {number[]} v - [lon, lat, ele]
     * @param {number} distRatio - Razão posição/comprimento total (0 a 1)
     * @param {number} total - Comprimento total da rota em metros
     * @returns {number[]} [x, y, z] em metros
     */
    linear(v, distRatio, total) {
        return [0, distRatio * total, v[2]];
    },

    /**
     * Modo Anel: distribui pontos em um círculo.
     * @param {number[]} v - [lon, lat, ele]
     * @param {number} distRatio - Razão posição/comprimento total (0 a 1)
     * @param {number} radius - Raio do anel
     * @returns {number[]} [x, y, z] em metros
     */
    ring(v, distRatio, radius) {
        return [
            radius * Math.cos(2 * Math.PI * distRatio),
            radius * Math.sin(2 * Math.PI * distRatio),
            v[2]
        ];
    },

    /**
     * Modo Mapa: projeta coordenadas usando a projeção cartográfica configurada.
     * @param {number[]} v - [lon, lat, ele]
     * @returns {number[]} [x, y, z] em metros
     */
    project(v) {
        return this.projection.forward([v[0], v[1]]).concat(v[2]);
    }
};


// ============================================================
// UTM - Detecção automática de zona UTM
// ============================================================

const UTM = {
    /**
     * Gera string de projeção proj4 para a zona UTM de um ponto.
     * @param {number} lat - Latitude em graus
     * @param {number} lon - Longitude em graus
     * @returns {string} Definição proj4 para a zona UTM
     */
    proj(lat, lon) {
        let proj = "+proj=utm +zone=";
        proj += this.zone(lon);
        proj += this.hemi(lat);
        proj += " +ellps=WGS84 +datum=WGS84 +units=m +no_defs";
        return proj;
    },

    hemi(lat) {
        return lat < 0 ? ' +south' : '';
    },

    zone(lon) {
        lon += 180;
        lon -= lon % 6;
        lon /= 6;
        return lon + 1;
    }
};


// ============================================================
// BOUNDS - Gerenciamento de limites (bounding box)
// ============================================================

class Bounds {
    /**
     * @param {number[]} [xyz] - Ponto inicial [x, y, z]
     */
    constructor(xyz) {
        if (xyz) {
            this.minx = this.maxx = xyz[0];
            this.miny = this.maxy = xyz[1];
            this.minz = this.maxz = xyz[2];
        } else {
            this.minx = this.maxx = 0;
            this.miny = this.maxy = 0;
            this.minz = this.maxz = 0;
        }
    }

    /**
     * Expande os limites para incluir um novo ponto.
     * @param {number[]} xyz - [x, y, z]
     */
    update(xyz) {
        if (xyz[0] < this.minx) this.minx = xyz[0];
        if (xyz[0] > this.maxx) this.maxx = xyz[0];
        if (xyz[1] < this.miny) this.miny = xyz[1];
        if (xyz[1] > this.maxy) this.maxy = xyz[1];
        if (xyz[2] < this.minz) this.minz = xyz[2];
        if (xyz[2] > this.maxz) this.maxz = xyz[2];
    }

    /**
     * Retorna o centro dos limites XY.
     * @returns {number[]} [x, y]
     */
    center() {
        return [(this.minx + this.maxx) / 2, (this.miny + this.maxy) / 2];
    }
}


// ============================================================
// FUNÇÕES AUXILIARES DE GEOMETRIA
// ============================================================

/**
 * Calcula o ângulo 2D do vetor entre dois pontos.
 * @param {number[]} a - Ponto A [x, y, ...]
 * @param {number[]} b - Ponto B [x, y, ...]
 * @returns {number} Ângulo em radianos
 */
function vectorAngle(a, b) {
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/**
 * Calcula offsets para centralizar o modelo na origem.
 * @param {Bounds} bounds - Limites do modelo
 * @param {boolean} zcut - Se deve cortar na elevação mínima
 * @returns {number[]} [xOffset, yOffset, zOffset]
 */
function calcOffsets(bounds, zcut) {
    const xy = bounds.center();
    let zoffset = 0;
    if (zcut === true || bounds.minz <= 0) {
        zoffset = Math.floor(bounds.minz - 1);
    }
    return [xy[0], xy[1], zoffset];
}

/**
 * Calcula fator de escala para caber nos limites da mesa.
 * @param {{x: number, y: number}} bed - Dimensões disponíveis da mesa
 * @param {number} xextent - Extensão X do modelo
 * @param {number} yextent - Extensão Y do modelo
 * @returns {number} Fator de escala
 */
function calcScale(bed, xextent, yextent) {
    const xscale = bed.x / xextent;
    const yscale = bed.y / yextent;
    return Math.min(xscale, yscale);
}

/**
 * Calcula escala a partir de bounds.
 * @param {Bounds} bounds
 * @param {{x: number, y: number}} bed
 * @returns {number}
 */
function scaleBounds(bounds, bed) {
    return calcScale(bed, bounds.maxx - bounds.minx, bounds.maxy - bounds.miny);
}

/**
 * Formata distância em texto legível.
 * @param {number} meters - Distância em metros
 * @returns {string} Ex: "5.2 km" ou "800 m"
 */
function formatDistance(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(1) + ' km';
    }
    return Math.round(meters) + ' m';
}

/**
 * Formata elevação em texto legível.
 * @param {number} meters - Elevação em metros
 * @returns {string} Ex: "1.200 m"
 */
function formatElevation(meters) {
    return Math.round(meters).toLocaleString('pt-BR') + ' m';
}
