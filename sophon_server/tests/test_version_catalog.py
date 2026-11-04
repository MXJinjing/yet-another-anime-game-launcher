import unittest
from unittest.mock import patch
import services.version_catalog as catalog

class VersionCatalogTests(unittest.TestCase):
    def setUp(self):catalog._cache.clear()
    def build(self,region,tag=None):
        if tag=='1.0.0':raise ValueError('not found')
        return {'retcode':0,'data':{'tag':tag or '5.0.0','manifests':[{}]}}
    def test_all_indexed_versions_confirmed_and_sorted(self):
        with patch.object(catalog,'indexed_versions',return_value={'1.0.0','4.5.0','4.5.1'}),patch.object(catalog,'query_build',side_effect=self.build) as query:
            value=catalog.available_versions('cn')
            self.assertEqual(value['versions'],['5.0.0','4.5.1','4.5.0'])
            self.assertFalse(value['complete'])
            cached=catalog.available_versions('cn');self.assertTrue(cached['cached']);self.assertEqual(query.call_count,4)
            catalog.available_versions('cn',True);self.assertEqual(query.call_count,8)
    def test_network_failures_reported_not_cached(self):
        def build(region,tag=None):
            if tag:raise OSError('network unavailable')
            return self.build(region)
        with patch.object(catalog,'indexed_versions',return_value={'4.5.0'}),patch.object(catalog,'query_build',side_effect=build):
            value=catalog.available_versions('os')
            self.assertEqual(len(value['errors']),1);self.assertNotIn('os',catalog._cache)
    def test_sizes_from_metadata_and_missing_values(self):
        self.assertEqual(catalog.build_sizes({'manifests':[{'matching_field':'game','stats':{'uncompressed_size':'123','compressed_size':'100'}},{'matching_field':'en-us','stats':{}}]}),{'game':{'total_size':123,'download_size':100},'en-us':{'total_size':None,'download_size':None}})
        with patch.object(catalog,'indexed_versions',return_value=set()),patch.object(catalog,'query_build',return_value={'data':{'tag':'5.0.0','manifests':[{'matching_field':'game','stats':{'uncompressed_size':'123','compressed_size':'100'}}]}}):
            value=catalog.available_versions('cn')
            self.assertEqual(value['version_sizes']['5.0.0']['game']['total_size'],123)
            self.assertEqual(catalog.available_versions('cn')['version_sizes'],value['version_sizes'])

    def test_unknown_index_failure_not_silent(self):
        with patch.object(catalog,'indexed_versions',side_effect=OSError('index offline')):
            with self.assertRaises(OSError):catalog.available_versions('os')

if __name__=='__main__':unittest.main()
