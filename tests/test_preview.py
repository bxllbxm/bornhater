import importlib.util
import unittest
from pathlib import Path


class PreviewFlow(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('preview_engine', Path(__file__).resolve().parents[1] / 'td/engine.py')
        self.engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.engine)

    def test_only_the_connected_browser_can_acknowledge_a_frame(self):
        self.engine.client = ('127.0.0.1', 1234)
        self.engine.preview_pending = True
        self.engine.ack_preview(('127.0.0.1', 9999))
        self.assertTrue(self.engine.preview_pending)
        self.engine.ack_preview(self.engine.client)
        self.assertFalse(self.engine.preview_pending)

    def test_preview_waits_for_ack_and_caps_frame_rate(self):
        encoded = bytearray(b'\xff\xd8sample-frame\xff\xd9')
        sent = []

        class Top:
            def saveByteArray(self, *args, **kwargs):
                return encoded

        class Tracking:
            def op(self, path):
                return Top()

        class Server:
            def webSocketSendBinary(self, peer, data):
                sent.append((peer, data))

        class Parent:
            def op(self, name):
                return Server()
            def store(self, *args):
                pass
            def fetch(self, name, default):
                return default

        class Me:
            def parent(self):
                return Parent()

        self.engine.me = Me()
        self.engine.tracking = lambda: Tracking()
        self.engine.client = ('127.0.0.1', 1234)
        self.engine.ready = True
        self.engine.send_preview(1)
        self.assertEqual(sent, [(self.engine.client, encoded)])
        self.engine.send_preview(2)
        self.assertEqual(len(sent), 1)
        self.engine.ack_preview(self.engine.client)
        self.engine.send_preview(1.01)
        self.assertEqual(len(sent), 1)
        self.engine.send_preview(2)
        self.assertEqual(len(sent), 2)


if __name__ == '__main__':
    unittest.main()
