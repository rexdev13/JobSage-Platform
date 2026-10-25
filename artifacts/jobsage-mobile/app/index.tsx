import { Redirect } from "expo-router";
import React from "react";

export default function Index() {
  return <Redirect href={__DEV__ ? "/splash-preview" : "/workspace"} />;
}
