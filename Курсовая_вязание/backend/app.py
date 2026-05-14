import math
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

import jwt
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

import database

BACKEND_DIR = Path(__file__).resolve().parent
LIBRARY_DIR = BACKEND_DIR / "static" / "library"
JWT_SECRET = "change-me-secret"
JWT_ALG = "HS256"

app = Flask(__name__)
CORS(app)


def _require_json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a valid JSON object"}), 400)
    return data, None


def make_token(user_id):
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing bearer token"}), 401
        token = auth[7:]
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            request.user_id = int(payload["sub"])
        except Exception:
            return jsonify({"error": "Invalid token"}), 401
        return fn(*args, **kwargs)
    return wrapper


@app.route("/api/register", methods=["POST"])
def register():
    data, err = _require_json_object()
    if err: return err
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if len(username) < 3 or len(password) < 6:
        return jsonify({"error": "username>=3 and password>=6"}), 400
    if database.get_user_by_username(username):
        return jsonify({"error": "username exists"}), 409
    uid = database.create_user(username, generate_password_hash(password))
    return jsonify({"token": make_token(uid)}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data, err = _require_json_object()
    if err: return err
    user = database.get_user_by_username((data.get("username") or "").strip())
    if not user or not check_password_hash(user["password_hash"], data.get("password") or ""):
        return jsonify({"error": "Invalid credentials"}), 401
    return jsonify({"token": make_token(user["id"])})


@app.route("/api/me", methods=["GET"])
@login_required
def me():
    return jsonify(database.get_user_by_id(request.user_id) or {"id": request.user_id})


@app.route('/api/yarns', methods=['GET'])
@login_required
def get_yarns(): return jsonify(database.get_all_yarns(request.user_id)), 200

@app.route('/api/yarns', methods=['POST'])
@login_required
def create_yarn():
    data, error = _require_json_object();
    if error: return error
    new_id = database.add_yarn(request.user_id, data['name'], float(data['weight_per_skein_g']), float(data['length_per_skein_m']), float(data['price_per_skein']), data.get('composition'))
    return jsonify({'id': new_id}), 201

@app.route('/api/yarns/<int:yarn_id>', methods=['PUT'])
@login_required
def update_yarn(yarn_id):
    data, error = _require_json_object();
    if error: return error
    ok = database.update_yarn(request.user_id, yarn_id, **data)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Yarn not found'}),404)

@app.route('/api/yarns/<int:yarn_id>', methods=['DELETE'])
@login_required
def delete_yarn(yarn_id):
    ok = database.delete_yarn(request.user_id, yarn_id)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Yarn not found'}),404)

@app.route('/api/samples', methods=['GET'])
@login_required
def get_samples(): return jsonify(database.get_all_samples(request.user_id)), 200

@app.route('/api/samples', methods=['POST'])
@login_required
def create_sample():
    data, error = _require_json_object();
    if error: return error
    new_id = database.add_sample(request.user_id, data['name'], float(data['width_cm']), float(data['height_cm']), int(data['stitches']), int(data['rows']), float(data['weight_g']))
    return jsonify({'id': new_id}), 201

@app.route('/api/samples/<int:sample_id>', methods=['PUT'])
@login_required
def update_sample(sample_id):
    data, error = _require_json_object();
    if error: return error
    ok = database.update_sample(request.user_id, sample_id, **data)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Sample not found'}),404)

@app.route('/api/samples/<int:sample_id>', methods=['DELETE'])
@login_required
def delete_sample(sample_id):
    ok = database.delete_sample(request.user_id, sample_id)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Sample not found'}),404)

@app.route('/api/projects', methods=['GET'])
@login_required
def get_projects(): return jsonify(database.get_all_projects(request.user_id)), 200

@app.route('/api/projects/<int:project_id>', methods=['GET'])
@login_required
def get_project(project_id):
    p = database.get_project_by_id(request.user_id, project_id)
    return (jsonify(p),200) if p else (jsonify({'error':'Project not found'}),404)

@app.route('/api/projects', methods=['POST'])
@login_required
def create_project():
    data, error = _require_json_object();
    if error: return error
    new_id = database.add_project(request.user_id, data['name'], data['pattern_json'], data.get('yarn_id'), data.get('sample_id'))
    return jsonify({'id': new_id}), 201

@app.route('/api/projects/<int:project_id>', methods=['PUT'])
@login_required
def update_project(project_id):
    data, error = _require_json_object();
    if error: return error
    ok = database.update_project(request.user_id, project_id, **data)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Project not found'}),404)

@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
@login_required
def delete_project(project_id):
    ok = database.delete_project(request.user_id, project_id)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Project not found'}),404)

@app.route('/api/calculate', methods=['POST'])
@login_required
def calculate():
    data, _ = _require_json_object()
    sample = database.get_sample_by_id(request.user_id, data['sample_id'])
    yarn = database.get_yarn_by_id(request.user_id, data['yarn_id'])
    if not sample or not yarn: return jsonify({'error':'Sample or yarn not found'}),404
    objects=(data.get('pattern_json') or {}).get('objects',[])
    total_area=0.0
    for obj in objects:
        c=obj.get('customData') or {}; st=c.get('shapeType','rectangle')
        if st=='trapezoid': total_area += ((float(c.get('width_top_cm',0))+float(c.get('width_bottom_cm',0)))/2)*float(c.get('height_cm',0))
        elif st=='circle': r=float(c.get('width_cm',0))/2; total_area += math.pi*r*r
        elif st=='ellipse': total_area += math.pi*(float(c.get('width_cm',0))/2)*(float(c.get('height_cm',0))/2)
        elif st=='triangle': total_area += float(c.get('width_cm',0))*float(c.get('height_cm',0))/2
        else: total_area += float(c.get('width_cm',0))*float(c.get('height_cm',0))
    weight_per_cm2=float(sample['weight_g'])/(float(sample['width_cm'])*float(sample['height_cm']))
    total_g=total_area*weight_per_cm2
    total_m=total_g*float(yarn['length_per_skein_m'])/float(yarn['weight_per_skein_g'])
    skeins=math.ceil(total_g/float(yarn['weight_per_skein_g']))
    return jsonify({'totalYarnG':round(total_g,2),'totalYarnM':round(total_m,2),'skeinsNeeded':skeins,'totalPrice':round(skeins*float(yarn['price_per_skein']),2)})

@app.route('/api/library/upload', methods=['POST'])
@login_required
def library_upload():
    upload=request.files['file']; title=(request.form.get('name') or '').strip(); LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    stored=f"{uuid.uuid4().hex}.pdf"; upload.save(str(LIBRARY_DIR/stored))
    new_id=database.add_library_item(request.user_id, title, stored)
    return jsonify({'id':new_id,'name':title,'file_url':f'/static/library/{stored}'}),201

@app.route('/api/library/list', methods=['GET'])
@login_required
def library_list():
    rows=database.get_all_library(request.user_id)
    return jsonify([{'id':r['id'],'name':r['name'],'created_at':r['created_at'],'file_url':f"/static/library/{r['stored_filename']}"} for r in rows]),200

@app.route('/api/library/<int:library_id>', methods=['DELETE'])
@login_required
def library_delete(library_id):
    stored=database.delete_library_item(request.user_id, library_id)
    if not stored: return jsonify({'error':'Not found'}),404
    p=LIBRARY_DIR/stored
    if p.exists(): p.unlink()
    return jsonify({'message':'Deleted'}),200

if __name__ == '__main__':
    app.run(debug=True, port=5000)
