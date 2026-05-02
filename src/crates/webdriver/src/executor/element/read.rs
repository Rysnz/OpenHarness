use serde_json::Value;

use crate::executor::BridgeExecutor;
use crate::runtime::api;
use crate::server::response::WebDriverErrorResponse;

impl BridgeExecutor {
    async fn read_element_flag(
        &self,
        element_id: &str,
        script: &'static str,
    ) -> Result<Value, WebDriverErrorResponse> {
        api::element::exec_element_flag(self.state.clone(), &self.session.id, script, element_id)
            .await
    }

    async fn read_element_named_value(
        &self,
        element_id: &str,
        name: &str,
        script: &'static str,
    ) -> Result<Value, WebDriverErrorResponse> {
        api::element::exec_element_name_value(
            self.state.clone(),
            &self.session.id,
            script,
            element_id,
            name,
        )
        .await
    }

    async fn read_element_value(
        &self,
        element_id: &str,
        script: &'static str,
    ) -> Result<Value, WebDriverErrorResponse> {
        api::element::exec_element_value(self.state.clone(), &self.session.id, script, element_id)
            .await
    }

    pub async fn is_element_selected(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_flag(element_id, api::element::is_selected())
            .await
    }

    pub async fn is_element_displayed(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_flag(element_id, api::element::is_displayed())
            .await
    }

    pub async fn get_element_attribute(
        &self,
        element_id: &str,
        name: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_named_value(element_id, name, api::element::get_attribute())
            .await
    }

    pub async fn get_element_property(
        &self,
        element_id: &str,
        name: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_named_value(element_id, name, api::element::get_property())
            .await
    }

    pub async fn get_element_css_value(
        &self,
        element_id: &str,
        property_name: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_named_value(element_id, property_name, api::element::get_css_value())
            .await
    }

    pub async fn get_element_text(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_value(element_id, api::element::get_text())
            .await
    }

    pub async fn get_element_computed_role(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_value(element_id, api::element::get_computed_role())
            .await
    }

    pub async fn get_element_computed_label(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_value(element_id, api::element::get_computed_label())
            .await
    }

    pub async fn get_element_name(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_value(element_id, api::element::get_name())
            .await
    }

    pub async fn get_element_rect(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_value(element_id, api::element::get_rect())
            .await
    }

    pub async fn is_element_enabled(
        &self,
        element_id: &str,
    ) -> Result<Value, WebDriverErrorResponse> {
        self.read_element_flag(element_id, api::element::is_enabled())
            .await
    }
}
