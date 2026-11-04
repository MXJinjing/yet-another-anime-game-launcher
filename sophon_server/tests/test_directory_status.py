import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from services.directory_status import directory_status
from api.server import historical_status

class DirectoryStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
    def test_region_and_read_only(self):
        for channel,sub,region in [('1','1','cn'),('1','0','os'),('14','0','bb')]:
            config=self.root/'config.ini'
            config.write_text(f'[General]\ngame_version=4.5.0\nchannel={channel}\nsub_channel={sub}\n')
            before=config.read_bytes()
            result=asyncio.run(historical_status(str(self.root)))
            self.assertEqual(result['region'],region)
            self.assertEqual(result['package'],'hk4e_'+region)
            self.assertEqual(config.read_bytes(),before)
            self.assertFalse((self.root/'.sophon').exists())
    def test_pending_state_and_missing_directory(self):
        state=self.root/'.sophon';state.mkdir()
        (state/'state.json').write_text(json.dumps({'schema':1,'game_type':'hk4e','region':'cn','version':None,'pending_version':'4.5.0'}))
        result=directory_status(str(self.root))
        self.assertEqual(result['status'],'install_pending')
        self.assertEqual(result['region'],'cn')
        missing=self.root/'missing'
        self.assertEqual(directory_status(str(missing))['status'],'directory_missing')
        self.assertFalse(missing.exists())
    def test_invalid_config_and_unknown_region(self):
        (self.root/'config.ini').write_text('[General]\ngame_version=4.5.0\n')
        self.assertIsNone(directory_status(str(self.root))['region'])
        (self.root/'config.ini').write_text('invalid config')
        with self.assertRaises(ValueError):directory_status(str(self.root))

if __name__=='__main__':unittest.main()
