import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zstandard
import manifest_pb2
import services.manifest_browser as browser

class ManifestBrowserTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.env=patch.dict('os.environ',{'SOPHON_MANIFEST_CACHE':str(self.root)});self.env.start();self.addCleanup(self.env.stop)
        browser._cache.clear()
        self.pb=manifest_pb2.Manifest()
        for name in ['root.bin','data/a.bin','data/sub/b.bin']:
            self.pb.files.add(filename=name,size=12,md5='0'*32)
        self.raw=zstandard.ZstdCompressor().compress(self.pb.SerializeToString())
        self.build={'data':{'tag':'4.5.0','manifests':[{'matching_field':'game','manifest':{'id':'id','compressed_size':len(self.raw)},'manifest_download':{'url_prefix':'https://example.invalid'}}]}}
    def test_directory_file_and_search(self):
        index=browser.DirectoryIndex(self.pb)
        root=index.listing()
        self.assertEqual([x['filename'] for x in root['files']],['data','root.bin'])
        self.assertEqual(index.listing('data')['total'],2)
        self.assertEqual(index.listing('data/sub/b.bin')['files'][0]['size'],12)
        self.assertEqual(index.listing('.',pattern='*b.bin')['total'],1)
        with self.assertRaises(FileNotFoundError):index.listing('missing')
        with self.assertRaises(ValueError):index.listing('../data')
    def test_pagination_reuses_index_and_disk_cache(self):
        with patch.object(browser,'query_build',return_value=self.build) as query,patch.object(browser,'fetch_manifest',return_value=(self.raw,self.pb)) as fetch:
            browser.browse_files('os','4.5.0','game',limit=1)
            second=browser.browse_files('os','4.5.0','game',offset=1,limit=1)
            self.assertTrue(second['cached']);self.assertEqual(query.call_count,1);self.assertEqual(fetch.call_count,1)
            browser._cache.clear()
            browser.browse_files('os','4.5.0','game')
            self.assertEqual(fetch.call_count,1)
            file=next(self.root.glob('*.zstd'));file.write_bytes(self.raw[:-4]);browser._cache.clear()
            browser.browse_files('os','4.5.0','game');self.assertEqual(fetch.call_count,2)
            self.assertEqual(file.read_bytes(),self.raw)
    def test_incomplete_response_retried(self):
        class Response(io.BytesIO):
            headers={'Content-Length':str(len(self.raw))}
        with patch.object(browser.request,'urlopen',side_effect=[Response(self.raw[:-3]),Response(self.raw)] ) as open_url,patch.object(browser.time,'sleep'):
            raw,pb=browser.fetch_manifest('https://example.invalid',len(self.raw))
            self.assertEqual(raw,self.raw);self.assertEqual(len(pb.files),3);self.assertEqual(open_url.call_count,2)
    def test_refresh_refetches_manifest(self):
        with patch.object(browser,'query_build',return_value=self.build),patch.object(browser,'fetch_manifest',return_value=(self.raw,self.pb)) as fetch:
            browser.browse_files('os','4.5.0','game')
            browser.browse_files('os','4.5.0','game',refresh=True)
            self.assertEqual(fetch.call_count,2)

if __name__=='__main__':unittest.main()
