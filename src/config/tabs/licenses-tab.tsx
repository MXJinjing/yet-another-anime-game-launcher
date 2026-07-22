import {
  Button,
  HStack,
  Heading,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  VStack,
} from "@hope-ui/solid";
import { createSignal } from "solid-js";
import { Locale } from "../../locale";

const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2023 3Shain

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const STEAM_LICENSE_TEXT = `Copyright Notice: steam.exe and lsteamclient.dll (in the sidecar folder)

Copyright (c) 2015, 2019, 2020, 2021, 2022 Valve Corporation

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

function MITLicense() {
  return (
    <VStack spacing={"$4"} w="100%" alignItems="start" userSelect="text">
      <Heading>MIT License</Heading>
      <Text userSelect="text">Copyright (c) 2023 3Shain</Text>
      <Text>
        Permission is hereby granted, free of charge, to any person obtaining a
        copy of this software and associated documentation files (the
        "Software"), to deal in the Software without restriction, including
        without limitation the rights to use, copy, modify, merge, publish,
        distribute, sublicense, and/or sell copies of the Software, and to
        permit persons to whom the Software is furnished to do so, subject to
        the following conditions:
      </Text>
      <Text>
        The above copyright notice and this permission notice shall be included
        in all copies or substantial portions of the Software.
      </Text>
      <Text>
        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
        CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
        TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
      </Text>
    </VStack>
  );
}

function SteamLicense() {
  return (
    <VStack spacing={"$4"} w="100%" alignItems="start" userSelect="text">
      <Heading>
        Copyright Notice: steam.exe and lsteamclient.dll (in the sidecar folder)
      </Heading>
      <Text>Copyright (c) 2015, 2019, 2020, 2021, 2022 Valve Corporation</Text>
      <Text>All rights reserved.</Text>
      <Text>
        Redistribution and use in source and binary forms, with or without
        modification, are permitted provided that the following conditions are
        met:
      </Text>

      <Text>
        1. Redistributions of source code must retain the above copyright
        notice, this list of conditions and the following disclaimer.
      </Text>

      <Text>
        2. Redistributions in binary form must reproduce the above copyright
        notice, this list of conditions and the following disclaimer in the
        documentation and/or other materials provided with the distribution.
      </Text>

      <Text>
        3. Neither the name of the copyright holder nor the names of its
        contributors may be used to endorse or promote products derived from
        this software without specific prior written permission.
      </Text>

      <Text>
        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
        IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
        TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
        PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
        HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
        SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
        TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
        PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
        LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
        NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
        SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
      </Text>
    </VStack>
  );
}

export function LicensesTab(props: { locale: Locale }) {
  const [selectedLicense, setSelectedLicense] = createSignal(0);
  const licenseText = () =>
    selectedLicense() == 0 ? MIT_LICENSE_TEXT : STEAM_LICENSE_TEXT;

  return (
    <TabPanel flex={1} px={20} pt={0} pb={0} h="100%" overflowY="auto">
      <Tabs
        h="100%"
        display="flex"
        flexDirection="column"
        index={selectedLicense()}
        onChange={setSelectedLicense}
      >
        <HStack mb={"$4"} justifyContent="space-between">
          <TabList>
            <Tab>MIT</Tab>
            <Tab>Steam</Tab>
          </TabList>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => Neutralino.clipboard.writeText(licenseText())}
          >
            {props.locale.get("LICENSE_COPY")}
          </Button>
        </HStack>
        <TabPanel px={0} pt={0} pb={0} overflowY="auto">
          <MITLicense />
        </TabPanel>
        <TabPanel px={0} pt={0} pb={0} overflowY="auto">
          <SteamLicense />
        </TabPanel>
      </Tabs>
    </TabPanel>
  );
}
