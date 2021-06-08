const { mat2, mat2d, mat3, mat4, quat, quat2, vec2, vec3, vec4 } = glMatrix;

/* Lê um arquivo .OBJ (suporte limitado) */
function parse_obj(str)
{
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
                } else if (splitted.length == 1 || splitted.length == 2) {
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


/* Carrega os vértices de um .OBJ no buffer */
function load_obj(gl, obj)
{
    const data = [];

    for (const face of obj.faces) {
        for (const vertice_idx of face.vertices) {
            const vertice = obj.vertices[vertice_idx];
            data.push(vertice.x, vertice.y, vertice.z);
        }
    }

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
}


/**
 * Para cada grupo de faces, atribui uma cor aleatória. Se o objeto não tiver grupos,
 * ou tiver apenas um grupo, uma cor aleatória é atribuída a cada 2 faces consecutivas
 */
function load_colors(gl, n_faces, groups)
{
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

    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
}

/**
 * Encontra centro da bounding box dos vértices
 */
function find_center(vertices) {
    let [ xmax, xmin ] = [ vertices[0].x, vertices[0].x ];
    let [ ymax, ymin ] = [ vertices[0].y, vertices[0].y ];
    let [ zmax, zmin ] = [ vertices[0].z, vertices[0].z ];

    for (const v of vertices) {
        if (v.x > xmax) xmax = v.x;
        if (v.y > ymax) ymax = v.y;
        if (v.z > zmax) zmax = v.z;

        if (v.x < xmin) xmin = v.x;
        if (v.y < ymin) ymin = v.y;
        if (v.z < zmin) zmin = v.z;
    }

    const xc = (xmax + xmin)/2;
    const yc = (ymax + ymin)/2;
    const zc = (zmax + zmin)/2;

    const rv = {
        centro: { xc, yc, zc },
        max: { x: xmax, y: ymax, z: zmax },
        min: { x: xmin, y: ymin, z: zmin }
    };
    // console.log(rv);

    return rv;
}

// Utilitários
function radToDeg(r) { return r * 180 / Math.PI; }
function degToRad(d) { return d * Math.PI / 180; }


async function main()
{
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
    const u_modelview = gl.getUniformLocation(program, "u_modelview");
    const u_projectionview = gl.getUniformLocation(program, "u_projectionview");
    const u_transform = gl.getUniformLocation(program, "u_transform");

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Lê arquivo.obj
    const resp = await fetch("objs/cubo.obj");
    const str = await resp.text();
    const obj = parse_obj(str);

    // Carrega vértices no buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);
    load_obj(gl, obj);

    // Carrega cores no buffer
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(a_color);
    gl.vertexAttribPointer(a_color, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    load_colors(gl, obj.faces.length, obj.groups);

    // //////////////////////////////////////////////

    // Eye -- Posição da câmera sintética
    //        Quero que ele esteja posicionado no eixo z olhando para a origem
    const eye = vec3.fromValues(0, 0, 10);

    // ModelView -- É a matriz que representa como a câmera está posicionada no espaço.
    //              Quero que ela esteja com o up na direção do eixo Oy mesmo
    const yup = vec3.fromValues(0, 1, 0);
    const origin = vec3.fromValues(0, 0, 0);
    const modelview = mat4.create();
    mat4.lookAt(modelview, eye, origin, yup);

    // ProjectionView -- É a matriz que representa a projeção. Pode ser ortográfica ou
    //                   perspectiva
    const projectionview = mat4.create();
    const fovy = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const near = 1;
    const far = 2000;
    mat4.perspective(projectionview, fovy, aspect, near, far);

    // Transform -- É a matriz de transformação do objeto. Pode conter N transformações
    //              em sequência
    const zout = vec3.fromValues(0, 0, 1);
    const transform = mat4.create();
    mat4.rotate(transform, transform, degToRad(20), zout);
    console.log(transform);

    // ////////////////////////////////////////////////

    drawScene();

    // Draw the scene.
    function drawScene()
    {
        // Configurações iniciais para desenhar a cena
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(program);
        gl.bindVertexArray(vao);

        gl.uniformMatrix4fv(u_modelview, false, modelview);
        gl.uniformMatrix4fv(u_projectionview, false, projectionview);
        gl.uniformMatrix4fv(u_transform, false, transform);

        gl.drawArrays(gl.TRIANGLES, 0, obj.faces.length * obj.vertices.length);
    }
}

main();
