from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_ok_with_name_and_version():
    client = TestClient(create_app())
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "service": "ai-service", "version": "0.1.0"}


def test_unknown_route_returns_404_json():
    client = TestClient(create_app())
    res = client.get("/does-not-exist")
    assert res.status_code == 404
    assert res.json() == {"detail": "Not Found"}
