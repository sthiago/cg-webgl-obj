const { mat2, mat2d, mat3, mat4, quat, quat2, vec2, vec3, vec4 } = glMatrix;

const origin = vec3.fromValues(0, 0, 0);
const yup = vec3.fromValues(0, 1, 0);
const xup = vec3.fromValues(1, 0, 0);
const zout = vec3.fromValues(0, 0, 1);

let gl;
let drawScene;
let reqId;

let positionBuffer;
let normalBuffer;
let colorBuffer;

// Objeto
let obj;
let reposition_vector;
let bbox;

// Câmera sintética
let eye;
let target = origin;
let modelview = mat4.create();
let eye_dx = 0, eye_dy = 0, eye_dz = 0;
let eye_rx = 0, eye_ry = 0, eye_rz = 0;

// Projeção
let projectionview = mat4.create();
let tipo_projecao, fovy, aspect, near, far;
let left, right, bottom, _top;

// Objeto (transformações)
let rotacao = false;
let transform = mat4.create();
let identity = mat4.create();

let zbuffer = true;
let facecull = true;

// Iluminação
let light_position;
let intensidade, kd, ke, shininess;
let intensidade_amb, ka;
let calculate_normals = true;
let normals_available = false;


/**
* Função utilitária que gera números aleatórios baseados numa seed
* Fonte: https://stackoverflow.com/a/19303725/1694726
*/
let seed = 1;
function random() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

/*
* Função utilitária para ler um arquivo como string
* Fonte: https://stackoverflow.com/q/19842314/1694726
*/
function readSingleFile(evt, callback) {
    //Retrieve the first (and only!) File from the FileList object
    var f = evt.target.files[0];

    if (f) {
        var r = new FileReader();
        r.onload = function(e) {
            var contents = e.target.result;
            callback(contents);
        }
        r.readAsText(f);
    } else {
        alert("Failed to load file");
    }
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
                console.log(valores);
                alert("Arquivo .OBJ não suportado");
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
function load_obj(obj)
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

// Calcula normais (se necessário) e carrega no buffer. Pressupõe que os vértices estão
// em sentido antihorário.
function load_normals(obj)
{
    const data = [];

    if (obj.normals.length > 0 && obj.normals.length == obj.vertices.length) {
        normals_available = true;
    }

    // Verifica se existem normais e se a quantidade é igual ao número de vértices.
    // Verifica também se não está marcado para calcular normais
    if (!calculate_normals && obj.normals.length > 0 && obj.normals.length == obj.vertices.length) {

        for (const face of obj.faces) {
            for (const vertice_idx of face.vertices) {
                const normal = obj.normals[vertice_idx];
                data.push(normal.x, normal.y, normal.z);
            }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return;
    }

    // Caso não exista, calcula normais
    for (const face of obj.faces) {
        const _face = [];
        for (const vertice_idx of face.vertices) {
            const vertice = obj.vertices[vertice_idx];
            _face.push(vertice);
        }

        const vertice1 = vec3.fromValues(_face[0].x, _face[0].y, _face[0].z);
        const vertice2 = vec3.fromValues(_face[1].x, _face[1].y, _face[1].z);
        const vertice3 = vec3.fromValues(_face[2].x, _face[2].y, _face[2].z);

        const a = vec3.create();
        const b = vec3.create();

        vec3.subtract(a, vertice2, vertice1);
        vec3.subtract(b, vertice3, vertice1);

        const normal = vec3.create();
        vec3.cross(normal, a, b);

        data.push(normal[0], normal[1], normal[2]);
        data.push(normal[0], normal[1], normal[2]);
        data.push(normal[0], normal[1], normal[2]);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
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
        const colorR = Math.floor(random() * 256);
        const colorG = Math.floor(random() * 256);
        const colorB = Math.floor(random() * 256);
        for (let i = 0; i < n_faces; i+=1) {
            data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
            // data.push(colorR, colorG, colorB,colorR, colorG, colorB,colorR, colorG, colorB);
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

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(data), gl.STATIC_DRAW);
}

// Encontra bounding box dos vértices
function find_bbox(vertices) {
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

    const altura = ymax - ymin;
    const largura = xmax - xmin;
    const profundidade = zmax - zmin;

    const rv = {
        centro: { xc, yc, zc },
        dimensoes: { altura, largura, profundidade },
        max: { x: xmax, y: ymax, z: zmax },
        min: { x: xmin, y: ymin, z: zmin }
    };

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

    // Rotaciona o target em relação à câmera
    const rotated_target = vec3.create();
    vec3.rotateY(rotated_target, translated_target, eye, degToRad(eye_ry));
    vec3.rotateX(rotated_target, rotated_target, eye, degToRad(eye_rx));

    const up = vec3.create();
    vec3.rotateZ(up, yup, eye, degToRad(eye_rz));

    // Atualiza ModelView
    mat4.lookAt(modelview, translated_eye, rotated_target, up);
}


// Função de inicialização da projeção
function init_projection()
{
    tipo_projecao = "perspectiva";
    document.getElementById("radio_persp").checked = true;
    fovy = 60;
    aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    near = 1;
    far = 4000;
    mat4.perspective(projectionview, degToRad(fovy), aspect, near, far);

    // Inicializa valores da ortográfica também
    left = -1.5 * bbox.dimensoes.largura/2;
    right = 1.5 * bbox.dimensoes.largura/2;
    bottom = Math.floor(left / aspect);
    _top = Math.floor(right / aspect);

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


function update_light()
{
    intensidade_amb = parseFloat(document.getElementById("int_ambiente").value);
    ka = parseFloat(document.getElementById("ka").value);
    intensidade = parseFloat(document.getElementById("intensidade").value);
    kd = parseFloat(document.getElementById("kd").value);
    ke = parseFloat(document.getElementById("ke").value);
    shininess = parseFloat(document.getElementById("shininess").value);

    document.getElementById("int_ambiente_val").textContent = intensidade_amb;
    document.getElementById("ka_val").textContent = ka;
    document.getElementById("intensidade_val").textContent = intensidade;
    document.getElementById("kd_val").textContent = kd;
    document.getElementById("ke_val").textContent = ke;
    document.getElementById("shininess_val").textContent = shininess;
}


function init_controls()
{
    // Luz
    document.getElementById("int_ambiente").oninput = update_light;
    document.getElementById("ka").oninput = update_light;
    document.getElementById("intensidade").oninput = update_light;
    document.getElementById("kd").oninput = update_light;
    document.getElementById("ke").oninput = update_light;
    document.getElementById("shininess").oninput = update_light;

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

    // Normais
    document.getElementById("radio_calc_norm").checked = calculate_normals;
    document.getElementById("radio_usar_norm").checked = !calculate_normals;

    document.getElementById("radio_calc_norm").onchange = () => {
        calculate_normals = document.getElementById("radio_calc_norm").checked;
        load_normals(obj);
    }
    document.getElementById("radio_usar_norm").onchange = () => {
        calculate_normals = document.getElementById("radio_calc_norm").checked;
        load_normals(obj);
    }

    if (!normals_available) {
        document.getElementById("radio_usar_norm").disabled = true;
    }

    // Carregar objeto
    const reload = async () => {
        cancelAnimationFrame(reqId);

        gl = undefined;
        drawScene = undefined;
        reqId = undefined;

        positionBuffer = undefined;
        normalBuffer = undefined;
        colorBuffer = undefined;

        // Objeto
        obj = undefined;
        reposition_vector = undefined;
        bbox = undefined;

        // Câmera sintética
        eye = undefined;
        target = origin;
        modelview = mat4.create();
        eye_dx = 0; eye_dy = 0; eye_dz = 0;
        eye_rx = 0; eye_ry = 0; eye_rz = 0;

        // Projeção
        projectionview = mat4.create();
        tipo_projecao = undefined;
        fovy = undefined;
        aspect = undefined;
        near = undefined;
        far = undefined;
        left = undefined;
        right = undefined;
        bottom = undefined;
        _top = undefined;

        // Objeto (transformações)
        rotacao = false;
        transform = mat4.create();

        zbuffer = true;
        facecull = true;

        // Iluminação
        light_position = undefined;
        intensidade = undefined;
        kd = undefined;
        ke = undefined;
        shininess = undefined;
        intensidade_amb = undefined;
        ka = undefined;
        calculate_normals = true;
        normals_available = false;

        document.getElementById("radio_usar_norm").disabled = false;
    };

    document.getElementById("obj_lista").onchange = () => {
        reload();
        main();
    };

    document.getElementById('obj_externo').onchange = (evt) => {
        readSingleFile(evt, (contents) => {
            reload();
            main(false, contents);
        });
    };
}

function external_init_obj(file_contents) {
    obj = parse_obj(file_contents);

    // Encontra bbox do objeto
    bbox = find_bbox(obj.vertices);
    reposition_vector = vec3.fromValues(-bbox.centro.xc, -bbox.centro.yc, -bbox.centro.zc);
}

function init_light()
{
    light_position = vec3.fromValues(-1000, 1000, 1000);
    intensidade = 0.9;
    kd = 0.8;
    intensidade_amb = 0.2;
    ka = 0.2;
    ke = 0.9;
    shininess = 50;

    document.getElementById("int_ambiente_val").textContent = intensidade_amb;
    document.getElementById("ka_val").textContent = ka;
    document.getElementById("intensidade_val").textContent = intensidade;
    document.getElementById("kd_val").textContent = kd;
    document.getElementById("ke_val").textContent = ke;
    document.getElementById("shininess_val").textContent = shininess;

    document.getElementById("int_ambiente").value = intensidade_amb;
    document.getElementById("ka").value = ka;
    document.getElementById("intensidade").value = intensidade;
    document.getElementById("kd").value = kd;
    document.getElementById("ke").value = ke;
    document.getElementById("shininess").value = shininess;
}

async function init_obj()
{
    arquivo = document.getElementById("obj_lista").value;
    console.log(arquivo);

    // Lê arquivo.obj
    const resp = await fetch("objs/" + arquivo);
    const str = await resp.text();
    obj = parse_obj(str);

    // Encontra bbox do objeto
    bbox = find_bbox(obj.vertices);
    reposition_vector = vec3.fromValues(-bbox.centro.xc, -bbox.centro.yc, -bbox.centro.zc);
}

async function main(internal=true, file_contents)
{
    // Inicializações em geral
    seed = Date.now();

    const canvas = document.querySelector("#canvas");
    gl = canvas.getContext("webgl2");

    if (!gl) {
        alert("Sem suporte a WebGL 2.0");
        throw Error("Sem suporte a WebGL 2.0");
    }

    init_controls();
    if (internal && window.location.protocol != "file:") {
        await init_obj();
    } else if (file_contents != undefined) {
        external_init_obj(file_contents);
    } else {
        obj = {
            normals: [],
            groups: [],
            vertices: [
                {x: 0, y: 0, z: 0},
                {x: 0, y: 0, z: 100},
                {x: 0, y: 100, z: 0},
                {x: 0, y: 100, z: 100},
                {x: 100, y: 0, z: 0},
                {x: 100, y: 0, z: 100},
                {x: 100, y: 100, z: 0},
                {x: 100, y: 100, z: 100},
            ],
            faces: [
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 6, 4],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 2, 6],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 3, 2],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 1, 3],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [2, 7, 6],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [2, 3, 7],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [4, 6, 7],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [4, 7, 5],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 4, 5],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [0, 5, 1],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [1, 5, 7],
                },
                {
                    normals: [undefined, undefined, undefined],
                    vertices: [1, 7, 3],
                },
            ]
        };
        bbox = find_bbox(obj.vertices);
        reposition_vector = vec3.fromValues(-bbox.centro.xc, -bbox.centro.yc, -bbox.centro.zc);
    }
    init_projection();
    init_light();


    const program = initShaders(gl, "vs", "fs");

    // Configuração de atributos e uniforms
    const a_position = gl.getAttribLocation(program, "a_position");
    const a_normal = gl.getAttribLocation(program, "a_normal");
    const a_color = gl.getAttribLocation(program, "a_color");
    const u_modelview = gl.getUniformLocation(program, "u_modelview");
    const u_projectionview = gl.getUniformLocation(program, "u_projectionview");
    const u_transform = gl.getUniformLocation(program, "u_transform");
    const u_transform_invtransp = gl.getUniformLocation(program, "u_transform_invtransp");

    // Atributos e uniforms relacionas à iluminação
    const u_eyeposition = gl.getUniformLocation(program, "u_eyeposition");
    const u_lightposition = gl.getUniformLocation(program, "u_lightposition");
    const u_kd = gl.getUniformLocation(program, "u_kd");
    const u_intensidade = gl.getUniformLocation(program, "u_intensidade");
    const u_ka = gl.getUniformLocation(program, "u_ka");
    const u_intensidade_amb = gl.getUniformLocation(program, "u_intensidade_amb");
    const u_ke = gl.getUniformLocation(program, "u_ke");
    const u_shininess = gl.getUniformLocation(program, "u_shininess");

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Carrega vértices no buffer
    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(a_position);
    gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);
    load_obj(obj);

    // Calcula normais e carrega no buffer
    normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.enableVertexAttribArray(a_normal);
    gl.vertexAttribPointer(a_normal, 3, gl.FLOAT, false, 0, 0);
    load_normals(obj);

    // Carrega cores no buffer
    colorBuffer = gl.createBuffer();
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

    let initial_transform = mat4.create();

    // Coloca o centro da bbox do objeto na origem
    mat4.translate(transform, transform, reposition_vector);

    // Posiciona câmera a uma distância adequada do objeto
    const d = bbox.dimensoes.altura / (2 * Math.tan(degToRad(fovy/2)))
    init_camera(2 * d);

    // Deixa o zNear = 1, mas atualiza o zFar para pelo menos caber o objeto
    far = Math.min(4000, bbox.dimensoes.largura);

    // Posiciona a luz em um dos cantos da bbox ligeiramente expandida
    light_position = vec3.fromValues(
        -1.5 * bbox.dimensoes.largura/2,
        1.5 * bbox.dimensoes.altura/2,
        1.5 * bbox.dimensoes.profundidade/2,
        );

        // Inicializa os controles só agora, pra usar ranges que fazem sentido
        init_controls();

        // Draw the scene.
        drawScene = function(time)
        {
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            // Rotação do objeto
            if (rotacao) {
                mat4.rotate(transform, initial_transform, time*0.002, yup);
                mat4.translate(transform, transform, reposition_vector);
            }

            gl.uniformMatrix4fv(u_projectionview, false, projectionview);
            gl.uniformMatrix4fv(u_modelview, false, modelview);
            gl.uniformMatrix4fv(u_transform, false, transform);

            const transform_invtransp = mat4.create();
            mat4.invert(transform_invtransp, transform);
            mat4.transpose(transform_invtransp, transform_invtransp);

            gl.uniformMatrix4fv(u_transform, false, transform);
            gl.uniformMatrix4fv(u_transform_invtransp, false, transform_invtransp);

            gl.uniform3fv(u_eyeposition, eye);
            gl.uniform3fv(u_lightposition, light_position);

            gl.uniform1f(u_intensidade, intensidade);
            gl.uniform1f(u_kd, kd);
            gl.uniform1f(u_intensidade_amb, intensidade_amb);
            gl.uniform1f(u_ka, ka);
            gl.uniform1f(u_shininess, shininess);
            gl.uniform1f(u_ke, ke);

            gl.drawArrays(gl.TRIANGLES, 0, 3 * obj.faces.length);

            reqId = window.requestAnimationFrame(drawScene);
        }

        reqId = window.requestAnimationFrame(drawScene);
    }


    main();
