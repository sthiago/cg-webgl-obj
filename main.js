/* Lê um arquivo .OBJ (suporte limitado) */
function parse_obj(str) {
    const vertices = [];
    const normals = [];
    const faces = [];

    // Lista de inteiros. Cada inteiro n significa um grupo com n faces
    let groups = [];

    let group_count = 0
    const lines = str.split("\n");
    for (let l of lines) {
        l = l.trim();
        // Pula comentários, linhas vazias, e keywords não suportadas
        if (l[0] == "" || l.startsWith("#") || l.startsWith("vt")) continue;

        // Salva quantidade do grupo atual e começa novo grupo
        if (l.startsWith("g")) {
            groups.push(group_count);
            group_count = 0;
        }

        // Lê os vértices
        if (l.startsWith("v ")) {
            const valores = l.split(" ").filter(v => v != "");
            const v = {
                x: parseFloat(valores[1]),
                y: parseFloat(valores[2]),
                z: parseFloat(valores[3]),
            }
            vertices.push(v);
            continue;
        }

        // Lê as normais
        if (l.startsWith("vn ")) {
            const valores = l.split(" ").filter(v => v != "");
            const n = {
                x: parseFloat(valores[1]),
                y: parseFloat(valores[2]),
                z: parseFloat(valores[3]),
            }
            normals.push(n);
            continue;
        }

        // Lê as faces
        if (l.startsWith("f ")) {
            const valores = l.split(" ").filter(v => v != "");
            group_count += 1;

            // Suporta apenas faces com 3 vértices (triângulos)
            if (valores.length != 4) {
                console.log("Arquivo .OBJ não suportado");
                console.log(valores);
            }

            // Adiciona os vértices à face
            const f = { vertices: [], normals: [] };
            for (const valor of valores.slice(1)) {
                // Tenta splitar o valor em "/" pra saber se tem textcoords e normais
                const splitted = valor.split("/");
                let vertice_idx, normal_idx;
                if (splitted.length == 3) {
                    vertice_idx = parseInt(splitted[0]);
                    normal_idx = parseInt(splitted[2]);

                    // Resolve referências negativas
                    if (vertice_idx < 0) {
                        vertice_idx = vertices.length + vertice_idx;
                    } else {
                        vertice_idx = vertice_idx - 1;
                    }

                    if (normal_idx < 0) {
                        normal_idx = normals.length + normal_idx;
                    } else {
                        normal_idx = normal_idx - 1;
                    }
                } else if (splitted.length == 1) {
                    vertice_idx = parseInt(splitted[0]) - 1;
                }

                // Adiciona vértice/normal à face
                f.vertices.push(vertice_idx);
                f.normals.push(normal_idx);
            }
            faces.push(f);
        }
    }

    // Remove grupos com 0 faces
    groups = groups.filter(i => i != 0);

    const rv = { vertices, normals, faces, groups };
    console.log(rv);
    return rv;
}

function load_obj(gl, obj) {
    const data = [];

    for (const face of obj.faces) {
        for (const vertice_idx of face.vertices) {
            const vertice = obj.vertices[vertice_idx];
            data.push(vertice.x, vertice.y, vertice.z);
        }
    }

    console.log(data);

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
}

function load_colors(gl, n_faces, groups) {
    const data = [];

    if (groups.length == 0) {
        // De 2 em 2 pra ficar aproximadamente 1 cor por retângulo em vez de 1 cor por
        // triângulo
        for (let i = 0; i < n_faces; i+=2) {
            const colorR = Math.floor(Math.random() * 256);
            const colorG = Math.floor(Math.random() * 256);
            const colorB = Math.floor(Math.random() * 256);
            data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
            data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
        }
    } else {
        for (const n_faces_no_grupo of groups) {
            const colorR = Math.floor(Math.random() * 256);
            const colorG = Math.floor(Math.random() * 256);
            const colorB = Math.floor(Math.random() * 256);
            for (let i = 0; i < n_faces_no_grupo; i++) {
                data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
            }
        }
    }

    // console.log(data);

    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
}


// Utilitários
function radToDeg(r) {
    return r * 180 / Math.PI;
}

function degToRad(d) {
    return d * Math.PI / 180;
}

async function main() {
    // Inicializa contexto WebGL2
    const canvas = document.querySelector("#canvas");
    const gl = canvas.getContext("webgl2");

    if (!gl) {
        alert("Sem suporte a WebGL 2.0");
        throw Error("Sem suporte a WebGL 2.0");
    }

    const program = initShaders(gl, "vs", "fs");

    // Configuração de atributos e uniforms
    const a_position = gl.getAttribLocation(program, "a_position");
    const a_color = gl.getAttribLocation(program, "a_color");
    const u_matrix = gl.getUniformLocation(program, "u_matrix");
    const u_fudgefactor = gl.getUniformLocation(program, "u_fudgefactor");

    const positionBuffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(a_position);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Carrega os dados do F no buffer
    // setGeometry(gl);
    // const obj = parse_obj(pot);
    // load_obj(gl, obj);

    const resp = await fetch("objs/apples.obj");
    const str = await resp.text();
    const obj = parse_obj(str);
    load_obj(gl, obj);


    // Configura o ponteiro do buffer de posição (a_position)
    gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);

    // Mesma coisa, agora pra a_color
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    // setColors(gl);
    load_colors(gl, obj.faces.length, obj.groups);
    gl.enableVertexAttribArray(a_color);
    gl.vertexAttribPointer(a_color, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    // Valores iniciais
    const translation = [0, 0, -800];
    const rotation = [degToRad(30), degToRad(0), degToRad(0)];
    const scale = [1, 1, 1];

    drawScene();

    // Configura a interface
    webglLessonsUI.setupSlider("#x",      {value: translation[0], slide: updatePosition(0), min: -100, max: gl.canvas.width });
    webglLessonsUI.setupSlider("#y",      {value: translation[1], slide: updatePosition(1), min: -100, max: gl.canvas.height});
    webglLessonsUI.setupSlider("#z",      {value: translation[2], slide: updatePosition(2), min: -1000, max: 0});
    webglLessonsUI.setupSlider("#angleX", {value: radToDeg(rotation[0]), slide: updateRotation(0), min: -180, max: 180});
    webglLessonsUI.setupSlider("#angleY", {value: radToDeg(rotation[1]), slide: updateRotation(1), min: -180, max: 180});
    webglLessonsUI.setupSlider("#angleZ", {value: radToDeg(rotation[2]), slide: updateRotation(2), min: -180, max: 180});
    webglLessonsUI.setupSlider("#scaleX", {value: scale[0], slide: updateScale(0), min: -1, max: 1, step: 0.01, precision: 2});
    webglLessonsUI.setupSlider("#scaleY", {value: scale[1], slide: updateScale(1), min: -1, max: 1, step: 0.01, precision: 2});
    webglLessonsUI.setupSlider("#scaleZ", {value: scale[2], slide: updateScale(2), min: -1, max: 1, step: 0.01, precision: 2});

    // Draw the scene.
    function drawScene() {
        // webglUtils.resizeCanvasToDisplaySize(gl.canvas);

        // Configurações iniciais para desenhar a cena
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        gl.bindVertexArray(vao);

        // Calcula a matriz de transformações: projeção * translação * rotações * escala
        // No shader, essa matriz é multiplicada pela posição
        // const matrix = m4.projection(gl.canvas.clientWidth, gl.canvas.clientHeight, 400);
        // let matrix = m4.orthographic(0, gl.canvas.clientWidth, gl.canvas.clientHeight, 0, 400, -400)
        let matrix = m4.perspective(degToRad(60), gl.canvas.clientWidth / gl.canvas.clientHeight, 1, 2000)

        matrix = m4.translate(matrix, translation[0], translation[1], translation[2]);
        matrix = m4.xRotate(matrix, rotation[0]);
        matrix = m4.yRotate(matrix, rotation[1]);
        matrix = m4.zRotate(matrix, rotation[2]);
        matrix = m4.scale(matrix, scale[0], scale[1], scale[2]);

        gl.uniformMatrix4fv(u_matrix, false, matrix);
        gl.uniform1f(u_fudgefactor, 1.0);

        gl.drawArrays(gl.TRIANGLES, 0, obj.faces.length * obj.vertices.length);
    }

    // Handlers da UI
    function updatePosition(index) {
        return function(event, ui) {
            translation[index] = ui.value;
            drawScene();
        };
    }

    function updateRotation(index) {
        return function(event, ui) {
            var angleInDegrees = ui.value;
            var angleInRadians = degToRad(angleInDegrees);
            rotation[index] = angleInRadians;
            drawScene();
        };
    }

    function updateScale(index) {
        return function(event, ui) {
            scale[index] = ui.value;
            drawScene();
        };
    }
}

var m4 = {
    projection: function(width, height, depth) {
        // Note: This matrix flips the Y axis so 0 is at the top.
        return [
            2 / width, 0, 0, 0,
            0, -2 / height, 0, 0,
            0, 0, 2 / depth, 0,
            -1, 1, 0, 1,
        ];
    },

    orthographic: function(left, right, bottom, top, near, far) {
        return [
            2 / (right - left), 0, 0, 0,
            0, 2 / (top - bottom), 0, 0,
            0, 0, 2 / (near - far), 0,

            (left + right) / (left - right),
            (bottom + top) / (bottom - top),
            (near + far) / (near - far),
            1,
        ];
    },

    perspective: function(fieldOfViewInRadians, aspect, near, far) {
        var f = Math.tan(Math.PI * 0.5 - 0.5 * fieldOfViewInRadians);
        var rangeInv = 1.0 / (near - far);

        return [
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (near + far) * rangeInv, -1,
            0, 0, near * far * rangeInv * 2, 0
        ];
    },

    multiply: function(a, b) {
        var a00 = a[0 * 4 + 0];
        var a01 = a[0 * 4 + 1];
        var a02 = a[0 * 4 + 2];
        var a03 = a[0 * 4 + 3];
        var a10 = a[1 * 4 + 0];
        var a11 = a[1 * 4 + 1];
        var a12 = a[1 * 4 + 2];
        var a13 = a[1 * 4 + 3];
        var a20 = a[2 * 4 + 0];
        var a21 = a[2 * 4 + 1];
        var a22 = a[2 * 4 + 2];
        var a23 = a[2 * 4 + 3];
        var a30 = a[3 * 4 + 0];
        var a31 = a[3 * 4 + 1];
        var a32 = a[3 * 4 + 2];
        var a33 = a[3 * 4 + 3];
        var b00 = b[0 * 4 + 0];
        var b01 = b[0 * 4 + 1];
        var b02 = b[0 * 4 + 2];
        var b03 = b[0 * 4 + 3];
        var b10 = b[1 * 4 + 0];
        var b11 = b[1 * 4 + 1];
        var b12 = b[1 * 4 + 2];
        var b13 = b[1 * 4 + 3];
        var b20 = b[2 * 4 + 0];
        var b21 = b[2 * 4 + 1];
        var b22 = b[2 * 4 + 2];
        var b23 = b[2 * 4 + 3];
        var b30 = b[3 * 4 + 0];
        var b31 = b[3 * 4 + 1];
        var b32 = b[3 * 4 + 2];
        var b33 = b[3 * 4 + 3];

        return [
            b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30,
            b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31,
            b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32,
            b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33,
            b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30,
            b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31,
            b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32,
            b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33,
            b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30,
            b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31,
            b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32,
            b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33,
            b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30,
            b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31,
            b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32,
            b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33,
        ];
    },

    translation: function(tx, ty, tz) {
        return [
            1,  0,  0,  0,
            0,  1,  0,  0,
            0,  0,  1,  0,
            tx, ty, tz, 1,
        ];
    },

    xRotation: function(angleInRadians) {
        var c = Math.cos(angleInRadians);
        var s = Math.sin(angleInRadians);

        return [
            1, 0, 0, 0,
            0, c, s, 0,
            0, -s, c, 0,
            0, 0, 0, 1,
        ];
    },

    yRotation: function(angleInRadians) {
        var c = Math.cos(angleInRadians);
        var s = Math.sin(angleInRadians);

        return [
            c, 0, -s, 0,
            0, 1, 0, 0,
            s, 0, c, 0,
            0, 0, 0, 1,
        ];
    },

    zRotation: function(angleInRadians) {
        var c = Math.cos(angleInRadians);
        var s = Math.sin(angleInRadians);

        return [
            c, s, 0, 0,
            -s, c, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ];
    },

    scaling: function(sx, sy, sz) {
        return [
            sx, 0,  0,  0,
            0, sy,  0,  0,
            0,  0, sz,  0,
            0,  0,  0,  1,
        ];
    },

    translate: function(m, tx, ty, tz) {
        return m4.multiply(m, m4.translation(tx, ty, tz));
    },

    xRotate: function(m, angleInRadians) {
        return m4.multiply(m, m4.xRotation(angleInRadians));
    },

    yRotate: function(m, angleInRadians) {
        return m4.multiply(m, m4.yRotation(angleInRadians));
    },

    zRotate: function(m, angleInRadians) {
        return m4.multiply(m, m4.zRotation(angleInRadians));
    },

    scale: function(m, sx, sy, sz) {
        return m4.multiply(m, m4.scaling(sx, sy, sz));
    },
};

main();
