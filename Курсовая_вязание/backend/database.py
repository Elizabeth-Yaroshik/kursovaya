import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / 'knitting.db'


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(conn, table, column, ddl):
    cols = [r['name'] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    if column not in cols:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {ddl}')


def init_db():
    conn = get_db_connection()
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS yarns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        weight_per_skein_g REAL NOT NULL,
        length_per_skein_m REAL NOT NULL,
        price_per_skein REAL NOT NULL,
        composition TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        width_cm REAL NOT NULL,
        height_cm REAL NOT NULL,
        stitches INTEGER NOT NULL,
        rows INTEGER NOT NULL,
        weight_g REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        yarn_id INTEGER,
        sample_id INTEGER,
        pattern_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(yarn_id) REFERENCES yarns(id) ON DELETE SET NULL,
        FOREIGN KEY(sample_id) REFERENCES samples(id) ON DELETE SET NULL
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS library (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        stored_filename TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )''')
    _ensure_column(conn, 'yarns', 'user_id', 'user_id INTEGER')
    _ensure_column(conn, 'samples', 'user_id', 'user_id INTEGER')
    _ensure_column(conn, 'projects', 'user_id', 'user_id INTEGER')
    _ensure_column(conn, 'library', 'user_id', 'user_id INTEGER')
    conn.commit()
    conn.close()


init_db()


def create_user(username, password_hash):
    conn = get_db_connection()
    try:
        cur = conn.execute('INSERT INTO users (username, password_hash) VALUES (?,?)', (username, password_hash))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_user_by_username(username):
    conn = get_db_connection(); row = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone(); conn.close(); return dict(row) if row else None

def get_user_by_id(user_id):
    conn = get_db_connection(); row = conn.execute('SELECT id, username, created_at FROM users WHERE id=?', (user_id,)).fetchone(); conn.close(); return dict(row) if row else None

def add_yarn(user_id, name, weight_per_skein_g, length_per_skein_m, price_per_skein, composition=None):
    conn = get_db_connection(); cur = conn.execute('INSERT INTO yarns (user_id,name,weight_per_skein_g,length_per_skein_m,price_per_skein,composition) VALUES (?,?,?,?,?,?)', (user_id,name,weight_per_skein_g,length_per_skein_m,price_per_skein,composition)); conn.commit(); conn.close(); return cur.lastrowid

def get_all_yarns(user_id):
    conn = get_db_connection(); rows = conn.execute('SELECT * FROM yarns WHERE user_id=? ORDER BY created_at DESC', (user_id,)).fetchall(); conn.close(); return [dict(r) for r in rows]

def get_yarn_by_id(user_id, yarn_id):
    conn = get_db_connection(); row = conn.execute('SELECT * FROM yarns WHERE id=? AND user_id=?', (yarn_id,user_id)).fetchone(); conn.close(); return dict(row) if row else None

def update_yarn(user_id, yarn_id, **fields):
    vals=[]; sets=[]
    for k in ['name','weight_per_skein_g','length_per_skein_m','price_per_skein','composition']:
        if fields.get(k) is not None: sets.append(f'{k}=?'); vals.append(fields[k])
    if not sets: return True
    vals += [yarn_id, user_id]
    conn=get_db_connection(); cur=conn.execute(f"UPDATE yarns SET {', '.join(sets)} WHERE id=? AND user_id=?", vals); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def delete_yarn(user_id, yarn_id):
    conn=get_db_connection(); cur=conn.execute('DELETE FROM yarns WHERE id=? AND user_id=?',(yarn_id,user_id)); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def add_sample(user_id, name, width_cm, height_cm, stitches, rows, weight_g):
    conn=get_db_connection(); cur=conn.execute('INSERT INTO samples (user_id,name,width_cm,height_cm,stitches,rows,weight_g) VALUES (?,?,?,?,?,?,?)',(user_id,name,width_cm,height_cm,stitches,rows,weight_g)); conn.commit(); conn.close(); return cur.lastrowid

def get_all_samples(user_id):
    conn=get_db_connection(); rows=conn.execute('SELECT * FROM samples WHERE user_id=? ORDER BY created_at DESC',(user_id,)).fetchall(); conn.close(); return [dict(r) for r in rows]

def get_sample_by_id(user_id, sample_id):
    conn=get_db_connection(); row=conn.execute('SELECT * FROM samples WHERE id=? AND user_id=?',(sample_id,user_id)).fetchone(); conn.close(); return dict(row) if row else None

def update_sample(user_id, sample_id, **fields):
    vals=[]; sets=[]
    for k in ['name','width_cm','height_cm','stitches','rows','weight_g']:
        if fields.get(k) is not None: sets.append(f'{k}=?'); vals.append(fields[k])
    if not sets: return True
    vals += [sample_id, user_id]
    conn=get_db_connection(); cur=conn.execute(f"UPDATE samples SET {', '.join(sets)} WHERE id=? AND user_id=?", vals); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def delete_sample(user_id, sample_id):
    conn=get_db_connection(); cur=conn.execute('DELETE FROM samples WHERE id=? AND user_id=?',(sample_id,user_id)); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def add_project(user_id, name, pattern_json, yarn_id=None, sample_id=None):
    conn=get_db_connection(); cur=conn.execute('INSERT INTO projects (user_id,name,yarn_id,sample_id,pattern_json) VALUES (?,?,?,?,?)',(user_id,name,yarn_id,sample_id,json.dumps(pattern_json,ensure_ascii=False))); conn.commit(); conn.close(); return cur.lastrowid

def get_all_projects(user_id):
    conn=get_db_connection(); rows=conn.execute('SELECT id,name,created_at FROM projects WHERE user_id=? ORDER BY created_at DESC',(user_id,)).fetchall(); conn.close(); return [dict(r) for r in rows]

def get_project_by_id(user_id, project_id):
    conn=get_db_connection(); row=conn.execute('SELECT p.*, y.name as yarn_name, s.name as sample_name FROM projects p LEFT JOIN yarns y ON p.yarn_id=y.id AND y.user_id=p.user_id LEFT JOIN samples s ON p.sample_id=s.id AND s.user_id=p.user_id WHERE p.id=? AND p.user_id=?',(project_id,user_id)).fetchone(); conn.close();
    if not row: return None
    obj=dict(row); obj['pattern_json']=json.loads(obj['pattern_json']) if obj.get('pattern_json') else None; return obj

def update_project(user_id, project_id, **fields):
    vals=[]; sets=[]
    if fields.get('name') is not None: sets.append('name=?'); vals.append(fields['name'])
    if fields.get('pattern_json') is not None: sets.append('pattern_json=?'); vals.append(json.dumps(fields['pattern_json'], ensure_ascii=False))
    if 'yarn_id' in fields and fields.get('yarn_id') is not None: sets.append('yarn_id=?'); vals.append(fields['yarn_id'])
    if 'sample_id' in fields and fields.get('sample_id') is not None: sets.append('sample_id=?'); vals.append(fields['sample_id'])
    if not sets: return True
    vals += [project_id,user_id]
    conn=get_db_connection(); cur=conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id=? AND user_id=?", vals); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def delete_project(user_id, project_id):
    conn=get_db_connection(); cur=conn.execute('DELETE FROM projects WHERE id=? AND user_id=?',(project_id,user_id)); conn.commit(); ok=cur.rowcount>0; conn.close(); return ok

def add_library_item(user_id, name, stored_filename):
    conn=get_db_connection(); cur=conn.execute('INSERT INTO library (user_id,name,stored_filename) VALUES (?,?,?)',(user_id,name,stored_filename)); conn.commit(); conn.close(); return cur.lastrowid

def get_all_library(user_id):
    conn=get_db_connection(); rows=conn.execute('SELECT * FROM library WHERE user_id=? ORDER BY created_at DESC',(user_id,)).fetchall(); conn.close(); return [dict(r) for r in rows]

def delete_library_item(user_id, library_id):
    conn=get_db_connection(); row=conn.execute('SELECT stored_filename FROM library WHERE id=? AND user_id=?',(library_id,user_id)).fetchone();
    if not row: conn.close(); return None
    conn.execute('DELETE FROM library WHERE id=? AND user_id=?',(library_id,user_id)); conn.commit(); conn.close(); return row['stored_filename']
