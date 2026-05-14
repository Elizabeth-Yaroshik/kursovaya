from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1] / 'Курсовая_вязание' / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import app  # noqa: E402


def test_create_yarn_rejects_empty_json_body():
    client = app.test_client()

    response = client.post('/api/yarns', data='', content_type='application/json')

    assert response.status_code == 400
    assert response.get_json() == {'error': 'Request body must be a valid JSON object'}
