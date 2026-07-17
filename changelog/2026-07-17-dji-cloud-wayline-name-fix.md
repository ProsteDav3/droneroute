### Fixed

- Fixed mission and segment uploads to DJI Cloud silently corrupting the platform's wayline library. Names containing an underscore or a period (for example a mission literally named `Test_new`, or any auto-generated address name) were being accepted by our upload call but rejected by DJI Cloud's own naming rules when Pilot 2 tried to list them back — breaking the Flight Route Library ("No Data" / error 210002) for the whole workspace, not just the offending mission.
