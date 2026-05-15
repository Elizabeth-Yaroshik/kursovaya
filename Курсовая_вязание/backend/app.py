import math
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

import jwt
print("jwt location:", jwt.__file__)
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

def validate_positive_number(value, field_name, allow_zero=False, as_int=False):
    caster = int if as_int else float
    try:
        num = caster(value)
    except (TypeError, ValueError):
        return None, (jsonify({"error": f"{field_name} must be a number"}), 400)
    if allow_zero:
        if num < 0:
            return None, (jsonify({"error": f"{field_name} must be >= 0"}), 400)
    else:
        if num <= 0:
            return None, (jsonify({"error": f"{field_name} must be > 0"}), 400)
    return num, None


def make_token(user_id):
    payload = {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Missing bearer token"}), 401
        token = auth[7:].strip()
        if not token:
            return jsonify({"error": "Missing bearer token"}), 401
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            sub = payload.get("sub")
            if sub is None:
                raise ValueError("Token is missing sub")
            request.user_id = int(sub)
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
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name must not be empty"}), 400
    weight, err = validate_positive_number(data.get('weight_per_skein_g'), 'weight_per_skein_g')
    if err: return err
    length, err = validate_positive_number(data.get('length_per_skein_m'), 'length_per_skein_m')
    if err: return err
    price, err = validate_positive_number(data.get('price_per_skein'), 'price_per_skein', allow_zero=True)
    if err: return err
    composition = data.get('composition')
    if composition is not None and not isinstance(composition, str):
        return jsonify({"error": "composition must be a string or null"}), 400
    new_id = database.add_yarn(request.user_id, name, weight, length, price, composition)
    return jsonify({'id': new_id}), 201

@app.route('/api/yarns/<int:yarn_id>', methods=['PUT'])
@login_required
def update_yarn(yarn_id):
    data, error = _require_json_object();
    if error: return error
    payload = {}
    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name must not be empty"}), 400
        payload['name'] = name
    if 'weight_per_skein_g' in data:
        v, err = validate_positive_number(data.get('weight_per_skein_g'), 'weight_per_skein_g')
        if err: return err
        payload['weight_per_skein_g'] = v
    if 'length_per_skein_m' in data:
        v, err = validate_positive_number(data.get('length_per_skein_m'), 'length_per_skein_m')
        if err: return err
        payload['length_per_skein_m'] = v
    if 'price_per_skein' in data:
        v, err = validate_positive_number(data.get('price_per_skein'), 'price_per_skein', allow_zero=True)
        if err: return err
        payload['price_per_skein'] = v
    if 'composition' in data:
        if data.get('composition') is not None and not isinstance(data.get('composition'), str):
            return jsonify({"error": "composition must be a string or null"}), 400
        payload['composition'] = data.get('composition')
    ok = database.update_yarn(request.user_id, yarn_id, **payload)
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
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name must not be empty"}), 400
    width, err = validate_positive_number(data.get('width_cm'), 'width_cm')
    if err: return err
    height, err = validate_positive_number(data.get('height_cm'), 'height_cm')
    if err: return err
    stitches, err = validate_positive_number(data.get('stitches'), 'stitches', as_int=True)
    if err: return err
    rows, err = validate_positive_number(data.get('rows'), 'rows', as_int=True)
    if err: return err
    weight, err = validate_positive_number(data.get('weight_g'), 'weight_g')
    if err: return err
    new_id = database.add_sample(request.user_id, name, width, height, stitches, rows, weight)
    return jsonify({'id': new_id}), 201

@app.route('/api/samples/<int:sample_id>', methods=['PUT'])
@login_required
def update_sample(sample_id):
    data, error = _require_json_object();
    if error: return error
    payload = {}
    for field in ('name', 'width_cm', 'height_cm', 'stitches', 'rows', 'weight_g'):
        if field not in data:
            continue
        if field == 'name':
            v = (data.get(field) or '').strip()
            if not v:
                return jsonify({"error": "name must not be empty"}), 400
        elif field in ('stitches', 'rows'):
            v, err = validate_positive_number(data.get(field), field, as_int=True)
            if err: return err
        else:
            v, err = validate_positive_number(data.get(field), field)
            if err: return err
        payload[field] = v
    ok = database.update_sample(request.user_id, sample_id, **payload)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Sample not found'}),404)

@app.route('/api/samples/<int:sample_id>', methods=['DELETE'])
@login_required
def delete_sample(sample_id):
    ok = database.delete_sample(request.user_id, sample_id)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Sample not found'}),404)

@app.route('/api/projects', methods=['GET'])
@login_required
def get_projects(): return jsonify(database.get_all_projects(request.user_id)), 200

@app.route('/api/public-projects', methods=['GET'])
@login_required
def get_public_projects():
    sort = (request.args.get('sort') or 'new').strip()
    min_rating_raw = request.args.get('min_rating')
    min_rating = None
    if min_rating_raw not in (None, ''):
        min_rating, err = validate_positive_number(min_rating_raw, 'min_rating', allow_zero=True)
        if err: return err
    return jsonify(database.get_public_projects(sort=sort, min_rating=min_rating)), 200

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
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "name must not be empty"}), 400
    pattern_json = data.get('pattern_json')
    if not isinstance(pattern_json, dict) or not pattern_json:
        return jsonify({"error": "pattern_json must be a non-empty JSON object"}), 400
    yarn_id = data.get('yarn_id')
    sample_id = data.get('sample_id')
    if yarn_id is not None and not database.get_yarn_by_id(request.user_id, yarn_id):
        return jsonify({"error": "Yarn not found"}), 404
    if sample_id is not None and not database.get_sample_by_id(request.user_id, sample_id):
        return jsonify({"error": "Sample not found"}), 404
    new_id = database.add_project(request.user_id, name, pattern_json, yarn_id, sample_id)
    return jsonify({'id': new_id}), 201

@app.route('/api/projects/<int:project_id>', methods=['PUT'])
@login_required
def update_project(project_id):
    data, error = _require_json_object();
    if error: return error
    payload = {}
    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name must not be empty"}), 400
        payload['name'] = name
    if 'pattern_json' in data:
        pj = data.get('pattern_json')
        if not isinstance(pj, dict) or not pj:
            return jsonify({"error": "pattern_json must be a non-empty JSON object"}), 400
        payload['pattern_json'] = pj
    if 'yarn_id' in data:
        yarn_id = data.get('yarn_id')
        if yarn_id is not None and not database.get_yarn_by_id(request.user_id, yarn_id):
            return jsonify({"error": "Yarn not found"}), 404
        payload['yarn_id'] = yarn_id
    if 'sample_id' in data:
        sample_id = data.get('sample_id')
        if sample_id is not None and not database.get_sample_by_id(request.user_id, sample_id):
            return jsonify({"error": "Sample not found"}), 404
        payload['sample_id'] = sample_id
    if 'is_public' in data:
        if not isinstance(data.get('is_public'), bool):
            return jsonify({"error": "is_public must be boolean"}), 400
        payload['is_public'] = data.get('is_public')
    ok = database.update_project(request.user_id, project_id, **payload)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Project not found'}),404)

@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
@login_required
def delete_project(project_id):
    ok = database.delete_project(request.user_id, project_id)
    return (jsonify({'message':'ok'}),200) if ok else (jsonify({'error':'Project not found'}),404)

@app.route('/api/public-projects/<int:project_id>/reviews', methods=['GET'])
@login_required
def get_project_reviews(project_id):
    return jsonify(database.get_project_reviews(project_id)), 200

@app.route('/api/public-projects/<int:project_id>/reviews', methods=['POST'])
@login_required
def add_project_review(project_id):
    data, error = _require_json_object()
    if error: return error
    rating = data.get('rating')
    comment = (data.get('comment') or '').strip()
    if rating is None and not comment:
        return jsonify({"error": "rating or comment is required"}), 400
    if rating is not None:
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({"error": "rating must be integer from 1 to 5"}), 400
    rid = database.add_project_review(request.user_id, project_id, rating=rating, comment=comment or None)
    return jsonify({"id": rid}), 201

@app.route('/api/calculate', methods=['POST'])
@login_required
def calculate():
    data, err = _require_json_object()
    if err: return err
    default_sample = None
    default_yarn = None
    if data.get('sample_id') is not None:
      sample_id, err = validate_positive_number(data.get('sample_id'), 'sample_id', as_int=True)
      if err: return err
      default_sample = database.get_sample_by_id(request.user_id, sample_id)
      if not default_sample: return jsonify({'error':'Sample not found'}),404
    if data.get('yarn_id') is not None:
      yarn_id, err = validate_positive_number(data.get('yarn_id'), 'yarn_id', as_int=True)
      if err: return err
      default_yarn = database.get_yarn_by_id(request.user_id, yarn_id)
      if not default_yarn: return jsonify({'error':'Yarn not found'}),404
    objects=(data.get('pattern_json') or {}).get('objects',[])
    if not isinstance(objects, list):
        objects = []
    total_g=0.0
    total_m=0.0
    total_price=0.0
    total_skeins=0
    missing_details = 0
    for obj in objects:
        c=obj.get('customData') or {}; st=c.get('shapeType','rectangle')
        detail_sample = default_sample
        detail_yarn = default_yarn
        if c.get('sample_id') is not None:
            detail_sample = database.get_sample_by_id(request.user_id, int(c.get('sample_id')))
        if c.get('yarn_id') is not None:
            detail_yarn = database.get_yarn_by_id(request.user_id, int(c.get('yarn_id')))
        if not detail_sample or not detail_yarn:
            missing_details += 1
            continue
        area = 0.0
        if st=='trapezoid': area += ((float(c.get('width_top_cm',0))+float(c.get('width_bottom_cm',0)))/2)*float(c.get('height_cm',0))
        elif st=='circle': r=float(c.get('width_cm',0))/2; area += math.pi*r*r
        elif st=='ellipse': area += math.pi*(float(c.get('width_cm',0))/2)*(float(c.get('height_cm',0))/2)
        elif st=='triangle': area += float(c.get('width_cm',0))*float(c.get('height_cm',0))/2
        else: area += float(c.get('width_cm',0))*float(c.get('height_cm',0))
        weight_per_cm2=float(detail_sample['weight_g'])/(float(detail_sample['width_cm'])*float(detail_sample['height_cm']))
        detail_g = area * weight_per_cm2
        detail_m = detail_g * float(detail_yarn['length_per_skein_m']) / float(detail_yarn['weight_per_skein_g'])
        skeins = math.ceil(detail_g / float(detail_yarn['weight_per_skein_g']))
        total_g += detail_g
        total_m += detail_m
        total_skeins += skeins
        total_price += skeins * float(detail_yarn['price_per_skein'])
    if missing_details > 0:
        return jsonify({'error': f'Для {missing_details} деталей не выбраны пряжа/образец (ни локально, ни глобально).'}),400
    return jsonify({'totalYarnG':round(total_g,2),'totalYarnM':round(total_m,2),'skeinsNeeded':total_skeins,'totalPrice':round(total_price,2)})

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
