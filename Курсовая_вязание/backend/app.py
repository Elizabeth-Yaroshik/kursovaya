# backend/app.py

import uuid
import math
from pathlib import Path

from flask import Flask, request, jsonify
from flask_cors import CORS

import database

BACKEND_DIR = Path(__file__).resolve().parent
LIBRARY_DIR = BACKEND_DIR / 'static' / 'library'

app = Flask(__name__)
CORS(app)


def _log_api_exc(route: str, exc: BaseException) -> None:
    app.logger.exception('%s: %s', route, exc)


def _require_json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, (jsonify({'error': 'Request body must be a valid JSON object'}), 400)
    return data, None

@app.route('/')
def hello():
    return "Сервер калькулятора пряжи работает! Используйте API /api/..."


# ========================
# Эндпоинт для пряжи (yarns)
# ========================

@app.route('/api/yarns', methods=['GET'])
def get_yarns():
    try:
        yarns = database.get_all_yarns()
        return jsonify(yarns), 200
    except Exception as e:
        _log_api_exc('GET /api/yarns', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/yarns', methods=['POST'])
def create_yarn():
    try:
        data, error = _require_json_object()
        if error:
            return error
        required_fields = ['name', 'weight_per_skein_g', 'length_per_skein_m', 'price_per_skein']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        new_id = database.add_yarn(
            name=data['name'],
            weight_per_skein_g=float(data['weight_per_skein_g']),
            length_per_skein_m=float(data['length_per_skein_m']),
            price_per_skein=float(data['price_per_skein']),
            composition=data.get('composition')
        )
        return jsonify({'id': new_id, 'message': 'Yarn created successfully'}), 201
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/yarns/<int:yarn_id>', methods=['PUT'])
def update_yarn(yarn_id):
    try:
        data, error = _require_json_object()
        if error:
            return error
        updated = database.update_yarn(
            yarn_id=yarn_id,
            name=data.get('name'),
            weight_per_skein_g=data.get('weight_per_skein_g'),
            length_per_skein_m=data.get('length_per_skein_m'),
            price_per_skein=data.get('price_per_skein'),
            composition=data.get('composition')
        )
        if not updated:
            return jsonify({'error': 'Yarn not found'}), 404
        return jsonify({'message': 'Yarn updated successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/yarns/<int:yarn_id>', methods=['DELETE'])
def delete_yarn(yarn_id):
    try:
        deleted = database.delete_yarn(yarn_id)
        if not deleted:
            return jsonify({'error': 'Yarn not found'}), 404
        return jsonify({'message': 'Yarn deleted successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


# ========================
# Эндпоинт для образцов (samples)
# ========================

@app.route('/api/samples', methods=['GET'])
def get_samples():
    try:
        samples = database.get_all_samples()
        return jsonify(samples), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/samples', methods=['POST'])
def create_sample():
    try:
        data, error = _require_json_object()
        if error:
            return error
        required_fields = ['name', 'width_cm', 'height_cm', 'stitches', 'rows', 'weight_g']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        new_id = database.add_sample(
            name=data['name'],
            width_cm=float(data['width_cm']),
            height_cm=float(data['height_cm']),
            stitches=int(data['stitches']),
            rows=int(data['rows']),
            weight_g=float(data['weight_g'])
        )
        return jsonify({'id': new_id, 'message': 'Sample created successfully'}), 201
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/samples/<int:sample_id>', methods=['PUT'])
def update_sample(sample_id):
    try:
        data, error = _require_json_object()
        if error:
            return error
        updated = database.update_sample(
            sample_id=sample_id,
            name=data.get('name'),
            width_cm=data.get('width_cm'),
            height_cm=data.get('height_cm'),
            stitches=data.get('stitches'),
            rows=data.get('rows'),
            weight_g=data.get('weight_g')
        )
        if not updated:
            return jsonify({'error': 'Sample not found'}), 404
        return jsonify({'message': 'Sample updated successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/samples/<int:sample_id>', methods=['DELETE'])
def delete_sample(sample_id):
    try:
        deleted = database.delete_sample(sample_id)
        if not deleted:
            return jsonify({'error': 'Sample not found'}), 404
        return jsonify({'message': 'Sample deleted successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


# ========================
# Эндпоинт для проектов (projects)
# ========================

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """Список проектов (id, name, created_at) — без heavy pattern_json"""
    try:
        projects = database.get_all_projects()
        return jsonify(projects), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<int:project_id>', methods=['GET'])
def get_project(project_id):
    """Полный проект: все поля + имена пряжи/образца (через JOIN)"""
    try:
        project = database.get_project_by_id(project_id)
        if project is None:
            return jsonify({'error': 'Project not found'}), 404
        return jsonify(project), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects', methods=['POST'])
def create_project():
    """Создать новый проект.
    Ожидает JSON: {
        "name": str,
        "pattern_json": object,   # то, что вернул canvas.toJSON()
        "yarn_id": int (optional),
        "sample_id": int (optional)
    }
    """
    try:
        data, error = _require_json_object()
        if error:
            return error
        if 'name' not in data or 'pattern_json' not in data:
            return jsonify({'error': 'Missing required fields: name, pattern_json'}), 400

        new_id = database.add_project(
            name=data['name'],
            pattern_json=data['pattern_json'],  # передаём объект, database превратит в строку
            yarn_id=data.get('yarn_id'),
            sample_id=data.get('sample_id')
        )
        return jsonify({'id': new_id, 'message': 'Project created successfully'}), 201
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    """Обновить проект (частичное обновление).
    Можно передать любые из полей: name, pattern_json, yarn_id, sample_id.
    """
    try:
        data, error = _require_json_object()
        if error:
            return error
        updated = database.update_project(
            project_id=project_id,
            name=data.get('name'),
            pattern_json=data.get('pattern_json'),
            yarn_id=data.get('yarn_id'),
            sample_id=data.get('sample_id')
        )
        if not updated:
            return jsonify({'error': 'Project not found'}), 404
        return jsonify({'message': 'Project updated successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    """Удалить проект"""
    try:
        deleted = database.delete_project(project_id)
        if not deleted:
            return jsonify({'error': 'Project not found'}), 404
        return jsonify({'message': 'Project deleted successfully'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500

# ========================
# Эндпоинт расчёта расхода пряжи
# ========================

@app.route('/api/calculate', methods=['POST'])
def calculate_yarn():
    """
    Ожидает JSON:
    {
        "pattern_json": <объект выкройки fabric.js>,
        "sample_id": <int>,
        "yarn_id": <int>
    }
    Возвращает:
    {
        "totalYarnG": float,
        "totalYarnM": float,
        "skeinsNeeded": int,
        "totalPrice": float
    }
    """
    try:
        data = request.get_json()
        if not data or 'pattern_json' not in data or 'sample_id' not in data or 'yarn_id' not in data:
            return jsonify({'error': 'Missing required fields: pattern_json, sample_id, yarn_id'}), 400

        pattern = data['pattern_json']
        sample_id = data['sample_id']
        yarn_id = data['yarn_id']

        # 1. Получаем образец из БД
        sample = database.get_sample_by_id(sample_id)
        if not sample:
            return jsonify({'error': f'Sample with id {sample_id} not found'}), 404

        # 2. Получаем пряжу из БД
        yarn = database.get_yarn_by_id(yarn_id)
        if not yarn:
            return jsonify({'error': f'Yarn with id {yarn_id} not found'}), 404

        # 3. Анализируем pattern_json: площадь деталей по shapeType в customData
        objects = pattern.get('objects', [])
        if not objects:
            return jsonify({'error': 'No objects found in pattern_json'}), 400

        def detail_area_cm2(custom):
            """Площадь детали в см² или None, если данных недостаточно."""
            if not custom:
                return None
            st = custom.get('shapeType') or 'rectangle'
            try:
                if st == 'trapezoid':
                    wt = custom.get('width_top_cm')
                    wb = custom.get('width_bottom_cm')
                    h = custom.get('height_cm')
                    if wt is None or wb is None or h is None:
                        return None
                    return ((float(wt) + float(wb)) / 2.0) * float(h)
                if st == 'circle':
                    w = custom.get('width_cm')
                    if w is None:
                        return None
                    r = float(w) / 2.0
                    return math.pi * r * r
                if st == 'ellipse':
                    w = custom.get('width_cm')
                    h = custom.get('height_cm')
                    if w is None or h is None:
                        return None
                    return math.pi * (float(w) / 2.0) * (float(h) / 2.0)
                if st == 'triangle':
                    w = custom.get('width_cm')
                    h = custom.get('height_cm')
                    if w is None or h is None:
                        return None
                    return (float(w) * float(h)) / 2.0
                w = custom.get('width_cm')
                h = custom.get('height_cm')
                if w is None or h is None:
                    return None
                return float(w) * float(h)
            except (TypeError, ValueError):
                return None

        total_area_cm2 = 0.0
        for obj in objects:
            custom = obj.get('customData') or {}
            area = detail_area_cm2(custom)
            if area is not None and area > 0:
                total_area_cm2 += area

        if total_area_cm2 <= 0:
            return jsonify({'error': 'Нет деталей с валидными размерами в customData (см)'}), 400

        w_s = float(sample['width_cm'])
        h_s = float(sample['height_cm'])
        if w_s <= 0 or h_s <= 0:
            return jsonify({'error': 'Некорректные размеры образца'}), 400
        stitches_per_10cm = float(sample['stitches']) / (w_s / 10.0)
        rows_per_10cm = float(sample['rows']) / (h_s / 10.0)

        def detail_gauge_width_cm(custom):
            st = (custom or {}).get('shapeType') or 'rectangle'
            try:
                if st == 'trapezoid':
                    wt = custom.get('width_top_cm')
                    wb = custom.get('width_bottom_cm')
                    if wt is None or wb is None:
                        return None
                    return (float(wt) + float(wb)) / 2.0
                w = custom.get('width_cm')
                return float(w) if w is not None else None
            except (TypeError, ValueError):
                return None

        def detail_gauge_height_cm(custom):
            try:
                h = (custom or {}).get('height_cm')
                return float(h) if h is not None else None
            except (TypeError, ValueError):
                return None

        details_stitches = []
        for i, obj in enumerate(objects):
            custom = obj.get('customData') or {}
            gw = detail_gauge_width_cm(custom)
            gh = detail_gauge_height_cm(custom)
            entry = {'index': i, 'type': obj.get('type'), 'stitches': None, 'rows': None}
            if gw is not None and gh is not None and gw >= 0 and gh >= 0:
                try:
                    entry['stitches'] = int(round((gw / 10.0) * stitches_per_10cm))
                    entry['rows'] = int(round((gh / 10.0) * rows_per_10cm))
                except (TypeError, ValueError):
                    pass
            details_stitches.append(entry)

        # 4. Площадь образца (sample_width_cm * sample_height_cm)
        sample_area_cm2 = sample['width_cm'] * sample['height_cm']
        if sample_area_cm2 <= 0:
            return jsonify({'error': 'Sample area is zero'}), 400

        # 5. Вес образца в граммах
        sample_weight_g = sample['weight_g']

        # Расход пряжи на 1 см² (г/см²)
        weight_per_cm2 = sample_weight_g / sample_area_cm2

        # Общий вес для выкройки (г)
        total_yarn_g = total_area_cm2 * weight_per_cm2

        # 6. Пересчёт в метры
        # У пряжи: length_per_skein_m (метров на моток), weight_per_skein_g (вес мотка)
        # Метраж на 1 грамм = length_per_skein_m / weight_per_skein_g
        if yarn['weight_per_skein_g'] <= 0:
            return jsonify({'error': 'Invalid yarn weight per skein'}), 400
        meters_per_gram = yarn['length_per_skein_m'] / yarn['weight_per_skein_g']
        total_yarn_m = total_yarn_g * meters_per_gram

        # 7. Количество мотков (округляем вверх)
        skeins_needed = math.ceil(total_yarn_g / yarn['weight_per_skein_g'])

        # 8. Общая стоимость
        total_price = skeins_needed * yarn['price_per_skein']

        return jsonify({
            'totalYarnG': round(total_yarn_g, 2),
            'totalYarnM': round(total_yarn_m, 2),
            'skeinsNeeded': skeins_needed,
            'totalPrice': round(total_price, 2),
            'detailsStitches': details_stitches,
        }), 200

    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


# ========================
# Библиотека PDF (library)
# ========================

@app.route('/api/library/upload', methods=['POST'])
def library_upload():
    """Принимает multipart: file (PDF), name (строка — название в каталоге)."""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Нет поля file'}), 400
        upload = request.files['file']
        if not upload or upload.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        title = (request.form.get('name') or '').strip()
        if not title:
            return jsonify({'error': 'Укажите название'}), 400

        raw_filename = (upload.filename or '').strip()
        if not raw_filename.lower().endswith('.pdf'):
            return jsonify({'error': 'Допустимы только PDF-файлы'}), 400

        head = upload.read(5)
        upload.seek(0)
        if not head.startswith(b'%PDF'):
            return jsonify({'error': 'Файл не похож на PDF'}), 400

        LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
        stored = f'{uuid.uuid4().hex}.pdf'
        dest = LIBRARY_DIR / stored
        upload.save(str(dest))

        new_id = database.add_library_item(name=title, stored_filename=stored)
        file_url = f'/static/library/{stored}'
        return jsonify({'id': new_id, 'message': 'Uploaded', 'name': title, 'file_url': file_url}), 201
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/library/list', methods=['GET'])
def library_list():
    try:
        rows = database.get_all_library()
        items = [
            {
                'id': r['id'],
                'name': r['name'],
                'created_at': r['created_at'],
                'file_url': f"/static/library/{r['stored_filename']}",
            }
            for r in rows
        ]
        return jsonify(items), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


@app.route('/api/library/<int:library_id>', methods=['DELETE'])
def library_delete(library_id):
    try:
        stored = database.delete_library_item(library_id)
        if stored is None:
            return jsonify({'error': 'Not found'}), 404
        path = LIBRARY_DIR / stored
        if path.is_file():
            path.unlink()
        return jsonify({'message': 'Deleted'}), 200
    except Exception as e:
        _log_api_exc('API', e)
        return jsonify({'error': str(e)}), 500


# ========================
# Запуск сервера
# ========================

if __name__ == '__main__':
    app.run(debug=True, port=5000)