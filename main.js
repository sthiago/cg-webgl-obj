const { mat2, mat2d, mat3, mat4, quat, quat2, vec2, vec3, vec4 } = glMatrix;

const origin = vec3.fromValues(0, 0, 0);
const yup = vec3.fromValues(0, 1, 0);
const xup = vec3.fromValues(1, 0, 0);
const zout = vec3.fromValues(0, 0, 1);

let gl;
let drawScene;

// Câmera sintética
let eye;
let target = origin;
const modelview = mat4.create();
let eye_dx = 0, eye_dy = 0, eye_dz = 0;
let eye_rx = 0, eye_ry = 0, eye_rz = 0;

// Projeção
const projectionview = mat4.create();
let tipo_projecao, fovy, aspect, near, far;
let left, right, bottom, _top;

// Objeto (transformações)
let rotacao = false;
const transform = mat4.create();
const identity = mat4.create();

let zbuffer = true;
let facecull = true;


/**
 * Função utilitária que gera números aleatórios baseados numa seed
 * Fonte: https://stackoverflow.com/a/19303725/1694726
 */
let seed = 1;
function random() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}


// Utilitários
function radToDeg(r) { return r * 180 / Math.PI; }
function degToRad(d) { return d * Math.PI / 180; }


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
            const colorR = Math.floor(random() * 256);
            const colorG = Math.floor(random() * 256);
            const colorB = Math.floor(random() * 256);
            data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
            data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
        }
    } else {
        for (const n_faces_no_grupo of groups) {
            const colorR = Math.floor(random() * 256);
            const colorG = Math.floor(random() * 256);
            const colorB = Math.floor(random() * 256);
            for (let i = 0; i < n_faces_no_grupo; i++) {
                data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
            }
        }
    }

    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
}

// Encontra centro da bounding box dos vértices
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


// Função de inicialização da câmera sintética
function init_camera(distance)
{
    // Eye: Posição da câmera sintética
    eye = vec3.fromValues(0, 0, distance);

    // ModelView: Orientação da câmera sintética
    mat4.lookAt(modelview, eye, target, yup);
}


// Função que atualiza os parâmetros da câmera de acordo com a UI
function update_camera()
{
    eye_dx = parseFloat(document.getElementById("xeye").value);
    eye_dy = parseFloat(document.getElementById("yeye").value);
    eye_dz = parseFloat(document.getElementById("zeye").value);

    document.getElementById("xeye_val").textContent = eye_dx;
    document.getElementById("yeye_val").textContent = eye_dy;
    document.getElementById("zeye_val").textContent = eye_dz;

    eye_rx = parseFloat(document.getElementById("rxeye").value);
    eye_ry = parseFloat(document.getElementById("ryeye").value);
    eye_rz = parseFloat(document.getElementById("rzeye").value);

    document.getElementById("rxeye_val").textContent = eye_rx;
    document.getElementById("ryeye_val").textContent = eye_ry;
    document.getElementById("rzeye_val").textContent = eye_rz;


    // Translada a câmera
    const translation = vec3.fromValues(eye_dx, eye_dy, eye_dz);
    const translated_eye = vec3.create();
    vec3.add(translated_eye, eye, translation);

    // Translada o target
    const translated_target = vec3.create();
    vec3.add(translated_target, target, translation);

    // Atualiza ModelView
    mat4.lookAt(modelview, translated_eye, translated_target, yup);

    // Rotaciona ModelView
    mat4.rotate(modelview, modelview, degToRad(eye_rx), xup);
    mat4.rotate(modelview, modelview, degToRad(eye_ry), yup);
    mat4.rotate(modelview, modelview, degToRad(eye_rz), zout);
}


// Função de inicialização da projeção
function init_projection()
{
    tipo_projecao = "perspectiva";
    document.getElementById("radio_persp").checked = true;
    fovy = 60;
    aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    near = 1;
    far = 2000;
    mat4.perspective(projectionview, degToRad(fovy), aspect, near, far);

    // Inicializa valores da ortográfica também
    left = -10;
    right = 10;
    bottom = Math.floor(-10 / aspect);
    _top = Math.floor(10 / aspect);

    // Inicializa valores da UI
    document.getElementById("near").value = near;
    document.getElementById("near_val").textContent = near;

    document.getElementById("far").value = far;
    document.getElementById("far_val").textContent = far;

    document.getElementById("fovy").value = fovy;
    document.getElementById("fovy_val").textContent = fovy;

    document.getElementById("left").value = left;
    document.getElementById("left_val").textContent = left;
    document.getElementById("right").value = right;
    document.getElementById("right_val").textContent = right;
    document.getElementById("top").value = _top;
    document.getElementById("top_val").textContent = _top;
    document.getElementById("bottom").value = bottom;
    document.getElementById("bottom_val").textContent = bottom;
}


// Função que atualiza os parâmetros da projeção de acordo com a UI
function update_projection()
{
    // Troca tipo de projeção
    if (document.getElementById("radio_persp").checked) tipo_projecao = "perspectiva";
    if (document.getElementById("radio_ortho").checked) tipo_projecao = "ortografica";

    // Atualiza parâmetros das projeções
    near = parseFloat(document.getElementById("near").value);
    far = parseFloat(document.getElementById("far").value);
    fovy = parseFloat(document.getElementById("fovy").value);
    left = parseFloat(document.getElementById("left").value);
    right = parseFloat(document.getElementById("right").value);
    _top = parseFloat(document.getElementById("top").value);
    bottom = parseFloat(document.getElementById("bottom").value);

    document.getElementById("near_val").textContent = near;
    document.getElementById("far_val").textContent = far;
    document.getElementById("fovy_val").textContent = fovy;
    document.getElementById("left_val").textContent = left;
    document.getElementById("right_val").textContent = right;
    document.getElementById("top_val").textContent = _top;
    document.getElementById("bottom_val").textContent = bottom;

    // Atualiza projeção
    if (tipo_projecao == "perspectiva") {
        mat4.perspective(projectionview, degToRad(fovy), aspect, near, far);
    } else if (tipo_projecao == "ortografica") {
        mat4.ortho(projectionview, left, right, bottom, _top, near, far);
    }
}

function init_controls()
{
    // Posição e orientação da câmera
    document.getElementById("xeye").oninput = update_camera;
    document.getElementById("yeye").oninput = update_camera;
    document.getElementById("zeye").oninput = update_camera;
    document.getElementById("rxeye").oninput = update_camera;
    document.getElementById("ryeye").oninput = update_camera;
    document.getElementById("rzeye").oninput = update_camera;

    // Projeção
    document.getElementById("radio_persp").onchange = update_projection;
    document.getElementById("radio_ortho").onchange = update_projection;

    document.getElementById("near").oninput = update_projection;
    document.getElementById("far").oninput = update_projection;
    document.getElementById("fovy").oninput = update_projection;
    document.getElementById("left").oninput = update_projection;
    document.getElementById("right").oninput = update_projection;
    document.getElementById("top").oninput = update_projection;
    document.getElementById("bottom").oninput = update_projection;

    // Objeto
    document.getElementById("rotacao").onchange = () => {
      rotacao = document.getElementById("rotacao").checked;
    };

    // Outros
    document.getElementById("zbuffer").onchange = () => {
        zbuffer = document.getElementById("zbuffer").checked;
        if (zbuffer) {
            gl.enable(gl.DEPTH_TEST);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }
    };
    document.getElementById("facecull").onchange = () => {
        facecull = document.getElementById("facecull").checked;
        if (facecull) {
            gl.enable(gl.CULL_FACE);
        } else {
            gl.disable(gl.CULL_FACE);
        }
    };
}


// Função de inicialização geral
function init()
{
    seed = 1;

    // Inicializa contexto WebGL2
    const canvas = document.querySelector("#canvas");
    gl = canvas.getContext("webgl2");

    if (!gl) {
        alert("Sem suporte a WebGL 2.0");
        throw Error("Sem suporte a WebGL 2.0");
    }

    init_camera(10);
    init_projection();
    init_controls();
}


async function main()
{
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

    // Mais inicializações de GL
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    // Draw the scene.
    drawScene = function(time)
    {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Rotação do objeto
        if (rotacao) mat4.rotate(transform, identity, time*0.005, yup);

        gl.uniformMatrix4fv(u_modelview, false, modelview);
        gl.uniformMatrix4fv(u_projectionview, false, projectionview);
        gl.uniformMatrix4fv(u_transform, false, transform);

        gl.drawArrays(gl.TRIANGLES, 0, obj.faces.length * obj.vertices.length);

        window.requestAnimationFrame(drawScene);
    }

    window.requestAnimationFrame(drawScene);
}

init();
main();
