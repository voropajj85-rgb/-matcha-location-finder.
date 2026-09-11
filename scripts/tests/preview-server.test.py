"""Standard-library smoke checks for the developer preview server."""
import http.client
import importlib.util
from pathlib import Path
import sys
import threading
import unittest

sys.dont_write_bytecode = True
module_path = Path(__file__).resolve().parents[1] / "preview-server.py"
spec = importlib.util.spec_from_file_location("preview_server", module_path)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class QuietHandler(preview.PreviewHandler):
    def log_message(self, *args):
        pass


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = preview.ThreadingHTTPServer(("localhost", 0), QuietHandler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection(self.server.server_address[0], self.server.server_port, timeout=5)
        connection.request(method, path)
        response = connection.getresponse()
        result = response.status, response.getheaders(), response.read()
        connection.close()
        return result

    def test_document_root_and_relative_assets(self):
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertEqual(body, (preview.ROOT / "index.html").read_bytes())
        self.assertIn(("Cache-Control", "no-store"), headers)
        for url, mime in [("/js/app.js?v=preview", "text/javascript"),
                          ("/css/styles.css", "text/css"),
                          ("/js/generated/market-policy.js", "text/javascript")]:
            status, headers, body = self.request(url)
            self.assertEqual(status, 200, url)
            self.assertIn(("Content-type", mime), headers)
            self.assertTrue(body)

    def test_private_files_and_directory_listing_blocked(self):
        for url in ["/.git/config", "/.env", "/scripts/preview.ps1", "/docs/phase3c4.md",
                    "/js/", "/data/", "/%2e%67it/config", "/js/../.git/config"]:
            self.assertEqual(self.request(url)[0], 403, url)

    def test_missing_asset_and_head(self):
        self.assertEqual(self.request("/js/not-a-real-module.js")[0], 404)
        status, _, body = self.request("/index.html", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")

    def test_mutation_methods_are_not_supported(self):
        for method in ["POST", "PUT", "DELETE"]:
            self.assertEqual(self.request("/index.html", method)[0], 501)


if __name__ == "__main__":
    unittest.main()
