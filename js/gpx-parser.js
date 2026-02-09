/**
 * gpx-parser.js - Parser de arquivos GPX
 *
 * Extrai dados de trilhas GPS incluindo coordenadas e elevação.
 * Fornece informações resumidas sobre a trilha (distância, elevação, etc.)
 */

const GPXParser = {

    /**
     * Faz o parsing de um arquivo GPX (como texto XML).
     * Retorna objeto com pontos da trilha e metadados.
     *
     * @param {string} gpxText - Conteúdo do arquivo GPX como string
     * @param {boolean} forceElevation - Se deve forçar elevação padrão
     * @param {number} defaultElevation - Elevação padrão quando ausente
     * @returns {Object} { points, info, error }
     */
    parse(gpxText, forceElevation = false, defaultElevation = 1) {
        const result = { points: null, info: null, error: null };

        // Converter texto em documento XML
        let xmlDoc;
        try {
            const parser = new DOMParser();
            xmlDoc = parser.parseFromString(gpxText, 'text/xml');

            // Verificar erros de parsing
            const parseError = xmlDoc.querySelector('parsererror');
            if (parseError) {
                result.error = 'O arquivo não é um XML válido.';
                return result;
            }
        } catch (e) {
            result.error = 'Erro ao processar o arquivo GPX.';
            return result;
        }

        // Extrair tracks
        const tracks = xmlDoc.getElementsByTagName('trk');
        if (tracks.length === 0) {
            result.error = 'Este arquivo não contém nenhuma trilha (track). Verifique se é um arquivo GPX válido.';
            return result;
        }

        // Usar o primeiro track
        const track = tracks[0];
        const points = this._parseTrack(track, forceElevation, defaultElevation);

        if (points.length < 2) {
            result.error = 'A trilha não contém pontos suficientes (mínimo: 2).';
            return result;
        }

        // Calcular informações da trilha
        const info = this._calculateInfo(points, track);

        result.points = points;
        result.info = info;
        return result;
    },

    /**
     * Faz o parsing de um arquivo GPX a partir de um documento XML.
     * Compatibilidade com o fluxo original (XMLHttpRequest).
     *
     * @param {Document} xmlDoc - Documento XML
     * @param {boolean} forceElevation
     * @param {number} defaultElevation
     * @returns {number[][]|null} Array de [lon, lat, ele] ou null se erro
     */
    parseXML(xmlDoc, forceElevation = false, defaultElevation = 1) {
        const tracks = xmlDoc.getElementsByTagName('trk');
        if (tracks.length === 0) return null;

        const points = this._parseTrack(tracks[0], forceElevation, defaultElevation);
        return points.length >= 2 ? points : null;
    },

    /**
     * Extrai pontos de um elemento track.
     * Concatena todos os segmentos em uma única lista.
     *
     * @private
     * @param {Element} track - Elemento <trk> do XML
     * @param {boolean} forceElevation
     * @param {number} defaultElevation
     * @returns {number[][]} Array de [lon, lat, ele]
     */
    _parseTrack(track, forceElevation, defaultElevation) {
        const segments = track.getElementsByTagName('trkseg');
        let allPoints = [];

        for (let i = 0; i < segments.length; i++) {
            const segPoints = this._parseSegment(segments[i], forceElevation, defaultElevation);
            allPoints = allPoints.concat(segPoints);
        }

        return allPoints;
    },

    /**
     * Extrai pontos de um segmento de trilha.
     *
     * @private
     * @param {Element} segment - Elemento <trkseg>
     * @param {boolean} forceElevation
     * @param {number} defaultElevation
     * @returns {number[][]} Array de [lon, lat, ele]
     */
    _parseSegment(segment, forceElevation, defaultElevation) {
        const trkpts = segment.getElementsByTagName('trkpt');
        const points = [];

        for (let i = 0; i < trkpts.length; i++) {
            points.push(this._parsePoint(trkpts[i], forceElevation, defaultElevation));
        }

        return points;
    },

    /**
     * Extrai coordenadas de um ponto de trilha.
     *
     * @private
     * @param {Element} pt - Elemento <trkpt>
     * @param {boolean} forceElevation
     * @param {number} defaultElevation
     * @returns {number[]} [longitude, latitude, elevação]
     */
    _parsePoint(pt, forceElevation, defaultElevation) {
        let elevation = defaultElevation;

        if (!forceElevation) {
            const eleElements = pt.getElementsByTagName('ele');
            if (eleElements.length > 0) {
                elevation = parseFloat(eleElements[0].textContent);
            }
        }

        return [
            parseFloat(pt.getAttribute('lon')),
            parseFloat(pt.getAttribute('lat')),
            elevation
        ];
    },

    /**
     * Calcula informações resumidas sobre a trilha.
     *
     * @private
     * @param {number[][]} points - Array de [lon, lat, ele]
     * @param {Element} track - Elemento <trk> (para extrair nome)
     * @returns {Object} Informações da trilha
     */
    _calculateInfo(points, track) {
        // Nome da trilha
        let name = 'Trilha sem nome';
        const nameElements = track.getElementsByTagName('name');
        if (nameElements.length > 0) {
            name = nameElements[0].textContent;
        }

        // Calcular distância total, elevação min/max
        let totalDistance = 0;
        let minElevation = points[0][2];
        let maxElevation = points[0][2];
        let totalGain = 0;
        let totalLoss = 0;
        let hasElevation = false;

        for (let i = 0; i < points.length; i++) {
            const ele = points[i][2];

            if (ele !== 1 && ele !== 0) {
                hasElevation = true;
            }

            if (ele < minElevation) minElevation = ele;
            if (ele > maxElevation) maxElevation = ele;

            if (i > 0) {
                const dist = distVincenty(
                    points[i - 1][1], points[i - 1][0],
                    points[i][1], points[i][0]
                );
                totalDistance += dist;

                const eleDiff = ele - points[i - 1][2];
                if (eleDiff > 0) totalGain += eleDiff;
                else totalLoss += Math.abs(eleDiff);
            }
        }

        return {
            name,
            totalPoints: points.length,
            totalDistance,
            minElevation,
            maxElevation,
            totalGain,
            totalLoss,
            hasElevation,
            startCoord: { lat: points[0][1], lon: points[0][0] },
            endCoord: { lat: points[points.length - 1][1], lon: points[points.length - 1][0] }
        };
    }
};
