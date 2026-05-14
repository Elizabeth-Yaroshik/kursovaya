# backend/database.py

import sqlite3
import json
from pathlib import Path

# Определяем путь к файлу базы данных
DB_PATH = Path(__file__).parent / "knitting.db"

def get_db_connection():
    """Возвращает соединение с базой данных SQLite.
    Результаты запросов возвращаются в виде dict (через row_factory)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # чтобы обращаться к колонкам по имени
    return conn

def init_db():
    """Создаёт таблицы, если они ещё не существуют."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Таблица пряжи
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS yarns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            weight_per_skein_g REAL NOT NULL,
            length_per_skein_m REAL NOT NULL,
            price_per_skein REAL NOT NULL,
            composition TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Таблица образцов плотности
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            width_cm REAL NOT NULL,
            height_cm REAL NOT NULL,
            stitches INTEGER NOT NULL,
            rows INTEGER NOT NULL,
            weight_g REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Таблица проектов (выкройки + ссылки на пряжу и образец)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            yarn_id INTEGER,
            sample_id INTEGER,
            pattern_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(yarn_id) REFERENCES yarns(id) ON DELETE SET NULL,
            FOREIGN KEY(sample_id) REFERENCES samples(id) ON DELETE SET NULL
        )
    ''')

    # Библиотека PDF (выкройки, схемы)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            stored_filename TEXT NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.commit()
    conn.close()

# При импорте модуля сразу создаём таблицы
init_db()


# backend/database.py (продолжение, добавить после init_db)

# ========================
# CRUD для yarns (пряжа)
# ========================

def add_yarn(name, weight_per_skein_g, length_per_skein_m, price_per_skein, composition=None):
    """Добавить новую пряжу. Возвращает id добавленной записи."""
    conn = get_db_connection()
    cursor = conn.execute(
        '''INSERT INTO yarns (name, weight_per_skein_g, length_per_skein_m, price_per_skein, composition)
           VALUES (?, ?, ?, ?, ?)''',
        (name, weight_per_skein_g, length_per_skein_m, price_per_skein, composition)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_all_yarns():
    """Вернуть список всех записей пряжи в виде словарей."""
    conn = get_db_connection()
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM yarns ORDER BY created_at DESC').fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_yarn_by_id(yarn_id):
    """Вернуть одну запись пряжи по id или None."""
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM yarns WHERE id = ?', (yarn_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_yarn(yarn_id, name=None, weight_per_skein_g=None, length_per_skein_m=None,
                price_per_skein=None, composition=None):
    """Обновить указанные поля пряжи. Возвращает True, если запись существовала."""
    conn = get_db_connection()
    # Строим запрос динамически только по переданным параметрам
    fields = []
    values = []
    if name is not None:
        fields.append('name = ?')
        values.append(name)
    if weight_per_skein_g is not None:
        fields.append('weight_per_skein_g = ?')
        values.append(weight_per_skein_g)
    if length_per_skein_m is not None:
        fields.append('length_per_skein_m = ?')
        values.append(length_per_skein_m)
    if price_per_skein is not None:
        fields.append('price_per_skein = ?')
        values.append(price_per_skein)
    if composition is not None:
        fields.append('composition = ?')
        values.append(composition)

    if not fields:
        return True  # нечего обновлять

    values.append(yarn_id)
    query = f'UPDATE yarns SET {", ".join(fields)} WHERE id = ?'
    cursor = conn.execute(query, values)
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated


def delete_yarn(yarn_id):
    """Удалить пряжу. Возвращает True, если запись существовала."""
    conn = get_db_connection()
    cursor = conn.execute('DELETE FROM yarns WHERE id = ?', (yarn_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


# ========================
# CRUD для samples (образцы)
# ========================

def add_sample(name, width_cm, height_cm, stitches, rows, weight_g):
    conn = get_db_connection()
    cursor = conn.execute(
        '''INSERT INTO samples (name, width_cm, height_cm, stitches, rows, weight_g)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (name, width_cm, height_cm, stitches, rows, weight_g)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_all_samples():
    conn = get_db_connection()
    rows = conn.execute('SELECT * FROM samples ORDER BY created_at DESC').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_sample_by_id(sample_id):
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM samples WHERE id = ?', (sample_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_sample(sample_id, name=None, width_cm=None, height_cm=None,
                  stitches=None, rows=None, weight_g=None):
    conn = get_db_connection()
    fields = []
    values = []
    if name is not None:
        fields.append('name = ?')
        values.append(name)
    if width_cm is not None:
        fields.append('width_cm = ?')
        values.append(width_cm)
    if height_cm is not None:
        fields.append('height_cm = ?')
        values.append(height_cm)
    if stitches is not None:
        fields.append('stitches = ?')
        values.append(stitches)
    if rows is not None:
        fields.append('rows = ?')
        values.append(rows)
    if weight_g is not None:
        fields.append('weight_g = ?')
        values.append(weight_g)

    if not fields:
        return True
    values.append(sample_id)
    query = f'UPDATE samples SET {", ".join(fields)} WHERE id = ?'
    cursor = conn.execute(query, values)
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated


def delete_sample(sample_id):
    conn = get_db_connection()
    cursor = conn.execute('DELETE FROM samples WHERE id = ?', (sample_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


# ========================
# CRUD для projects (проекты)
# ========================
import json


def add_project(name, pattern_json, yarn_id=None, sample_id=None):
    """
    Добавить проект.
    pattern_json: Python-объект (словарь/список), который будет преобразован в JSON-строку для БД.
    Возвращает id нового проекта.
    """
    conn = get_db_connection()
    pattern_str = json.dumps(pattern_json, ensure_ascii=False)  # сериализуем в строку
    cursor = conn.execute(
        '''INSERT INTO projects (name, yarn_id, sample_id, pattern_json)
           VALUES (?, ?, ?, ?)''',
        (name, yarn_id, sample_id, pattern_str)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_all_projects():
    """Вернуть список проектов (без полного pattern_json, только id, name, created_at)."""
    conn = get_db_connection()
    rows = conn.execute('SELECT id, name, created_at FROM projects ORDER BY created_at DESC').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_project_by_id(project_id):
    """
    Вернуть полный проект по id.
    pattern_json в возвращаемом словаре будет уже разобран в Python-объект (list/dict).
    Также подтягивает имена пряжи и образца (через JOIN) для удобства.
    """
    conn = get_db_connection()
    row = conn.execute('''
        SELECT p.*, 
               y.name as yarn_name, 
               s.name as sample_name
        FROM projects p
        LEFT JOIN yarns y ON p.yarn_id = y.id
        LEFT JOIN samples s ON p.sample_id = s.id
        WHERE p.id = ?
    ''', (project_id,)).fetchone()
    conn.close()
    if not row:
        return None
    project = dict(row)
    # Преобразуем pattern_json из строки в Python-объект
    if project['pattern_json']:
        project['pattern_json'] = json.loads(project['pattern_json'])
    return project


def update_project(project_id, name=None, pattern_json=None, yarn_id=None, sample_id=None):
    """
    Обновить проект. Если pattern_json передан как Python-объект, он сериализуется.
    """
    conn = get_db_connection()
    exists = conn.execute('SELECT 1 FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not exists:
        conn.close()
        return False
    fields = []
    values = []
    if name is not None:
        fields.append('name = ?')
        values.append(name)
    if pattern_json is not None:
        fields.append('pattern_json = ?')
        values.append(json.dumps(pattern_json, ensure_ascii=False))
    if yarn_id is not None:
        fields.append('yarn_id = ?')
        values.append(yarn_id)
    if sample_id is not None:
        fields.append('sample_id = ?')
        values.append(sample_id)

    if not fields:
        return True
    values.append(project_id)
    query = f'UPDATE projects SET {", ".join(fields)} WHERE id = ?'
    cursor = conn.execute(query, values)
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated


def delete_project(project_id):
    conn = get_db_connection()
    cursor = conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


# ========================
# Библиотека PDF (library)
# ========================

def add_library_item(name, stored_filename):
    conn = get_db_connection()
    cursor = conn.execute(
        'INSERT INTO library (name, stored_filename) VALUES (?, ?)',
        (name, stored_filename),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id


def get_all_library():
    conn = get_db_connection()
    rows = conn.execute(
        'SELECT id, name, stored_filename, created_at FROM library ORDER BY created_at DESC'
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def delete_library_item(library_id):
    """Удалить запись. Возвращает stored_filename для удаления файла или None."""
    conn = get_db_connection()
    row = conn.execute(
        'SELECT stored_filename FROM library WHERE id = ?', (library_id,)
    ).fetchone()
    if not row:
        conn.close()
        return None
    fn = row['stored_filename']
    conn.execute('DELETE FROM library WHERE id = ?', (library_id,))
    conn.commit()
    conn.close()
    return fn